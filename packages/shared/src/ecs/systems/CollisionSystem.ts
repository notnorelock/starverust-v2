import { System } from '../core/System';
import type { World } from '../core/World';
import type { ComponentType } from '../core/ComponentType';
import type { EntityId } from '../core/EntityId';
import { PositionComponent } from '../components/PositionComponent';
import { VelocityComponent } from '../components/VelocityComponent';
import { PhysicsBodyComponent } from '../components/PhysicsBodyComponent';
import { CircleColliderComponent } from '../components/CircleColliderComponent';
import { RectColliderComponent } from '../components/RectColliderComponent';
import {
  SpatialHashGrid,
  testCircleCircle,
  testCircleRect,
  testRectRect,
  separate,
  slideAlongNormal,
  inverseMass,
  computeSubstepCount,
  circle,
  rect,
  layersCollide,
  type CollisionManifold,
} from '../../physics';

const DEFAULT_CELL_SIZE = 8; // world units; roughly a few entity-diameters per cell is a reasonable default

/**
 * Pipeline step 4 (Collision): broadphase (spatial hash grid) narrows down candidate
 * pairs, narrowphase (circle/rect tests from shared/physics) confirms actual overlaps,
 * and resolution separates overlapping bodies and slides velocity along the contact
 * normal. Runs after PhysicsSystem/MovementSystem have already moved entities this tick.
 *
 * Two passes:
 *  1. Continuous collision (sub-stepping) for dynamic bodies whose displacement this tick
 *     was large relative to their own collider size — walks them from their pre-movement
 *     position (PhysicsBodyComponent.prevX/prevY, recorded by PhysicsSystem) toward their
 *     post-movement position in several smaller steps, stopping at the first tick where a
 *     collision is detected, so a fast-moving small entity can't tunnel through a thin/small
 *     collider entirely within one discrete tick.
 *  2. Ordinary broadphase+narrowphase+resolution over final positions, which separates any
 *     remaining overlaps (including the resting contact a CCD stop leaves behind) and
 *     applies sliding.
 */
export class CollisionSystem extends System {
  readonly query: ReadonlyArray<ComponentType> = [PositionComponent];

  private readonly grid: SpatialHashGrid;
  private readonly visitedPairs = new Set<string>();

  constructor(cellSize: number = DEFAULT_CELL_SIZE) {
    super();
    this.grid = new SpatialHashGrid(cellSize);
  }

  override onFixedUpdate(fixedDt: number, world: World): void {
    this.runContinuousCollision(world);
    this.runDiscreteResolution(world, fixedDt);
  }

  // --- Pass 1: continuous collision (sub-stepping) for fast dynamic movers ---

  private runContinuousCollision(world: World): void {
    for (const entityId of world.entities.query(PositionComponent, PhysicsBodyComponent)) {
      const body = world.entities.getComponent(entityId, PhysicsBodyComponent);
      const position = world.entities.getComponent(entityId, PositionComponent);
      if (!body || !position || body.bodyType === 'static') {
        continue;
      }

      const colliderRadius = this.colliderRadiusFor(world, entityId);
      if (colliderRadius === undefined) {
        continue;
      }

      const dx = position.x - body.prevX;
      const dy = position.y - body.prevY;
      const substeps = computeSubstepCount(dx, dy, colliderRadius);
      if (substeps <= 1) {
        continue;
      }

      this.sweepEntity(world, entityId, body.prevX, body.prevY, position.x, position.y, substeps);
    }
  }

  /** Radius used for CCD's displacement-vs-size comparison — the collider's own radius, or half-extent for rects. */
  private colliderRadiusFor(world: World, entityId: EntityId): number | undefined {
    const circleCollider = world.entities.getComponent(entityId, CircleColliderComponent);
    if (circleCollider) {
      return circleCollider.radius;
    }
    const rectCollider = world.entities.getComponent(entityId, RectColliderComponent);
    if (rectCollider) {
      return Math.min(rectCollider.halfWidth, rectCollider.halfHeight);
    }
    return undefined;
  }

  /**
   * Walks `entityId` from (startX, startY) to (endX, endY) in `substeps` increments,
   * testing against every OTHER collider entity at each step and stopping at the first
   * step that overlaps something — leaving the entity at the last known-clear position
   * (a following discrete resolution pass handles any resulting resting contact).
   */
  private sweepEntity(
    world: World,
    entityId: EntityId,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    substeps: number,
  ): void {
    const position = world.entities.getComponent(entityId, PositionComponent)!;
    // Allocates a filtered array per fast-moving entity — acceptable here because CCD
    // sub-stepping only triggers for entities whose displacement this tick was large
    // relative to their own size (fast projectiles, not the common case of players/mobs
    // at normal speed), so this path runs rarely, unlike the per-tick broadphase below.
    const others = this.collectColliderEntities(world).filter((id) => id !== entityId);

    const stepX = (endX - startX) / substeps;
    const stepY = (endY - startY) / substeps;

    let lastClearX = startX;
    let lastClearY = startY;

    for (let step = 1; step <= substeps; step += 1) {
      position.x = startX + stepX * step;
      position.y = startY + stepY * step;

      let hit = false;
      for (const otherId of others) {
        if (this.testNarrowphase(world, entityId, otherId)) {
          hit = true;
          break;
        }
      }

      if (hit) {
        position.x = lastClearX;
        position.y = lastClearY;
        const velocity = world.entities.getComponent(entityId, VelocityComponent);
        if (velocity) {
          velocity.vx = 0;
          velocity.vy = 0;
        }
        return;
      }

      lastClearX = position.x;
      lastClearY = position.y;
    }
  }

  // --- Pass 2: ordinary discrete broadphase + narrowphase + resolution ---

  private runDiscreteResolution(world: World, fixedDt: number): void {
    this.grid.clear();
    this.visitedPairs.clear();

    const colliderEntities = this.collectColliderEntities(world);
    for (const entityId of colliderEntities) {
      const [minX, minY, maxX, maxY] = this.boundsFor(world, entityId);
      this.grid.insert(entityId, minX, minY, maxX, maxY);
    }

    this.grid.forEachPair((a, b) => {
      const pairKey = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (this.visitedPairs.has(pairKey)) {
        return;
      }
      this.visitedPairs.add(pairKey);
      this.resolvePair(world, a, b);
    });

    void fixedDt; // reserved for future velocity-dependent resolution (e.g. restitution/bounce)
  }

  private collectColliderEntities(world: World): EntityId[] {
    const ids: EntityId[] = [];
    for (const entityId of world.entities.query(PositionComponent, CircleColliderComponent)) {
      ids.push(entityId);
    }
    for (const entityId of world.entities.query(PositionComponent, RectColliderComponent)) {
      if (!world.entities.hasComponent(entityId, CircleColliderComponent)) {
        ids.push(entityId);
      }
    }
    return ids;
  }

  private boundsFor(world: World, entityId: EntityId): [number, number, number, number] {
    const position = world.entities.getComponent(entityId, PositionComponent)!;
    const circleCollider = world.entities.getComponent(entityId, CircleColliderComponent);
    if (circleCollider) {
      return [
        position.x - circleCollider.radius,
        position.y - circleCollider.radius,
        position.x + circleCollider.radius,
        position.y + circleCollider.radius,
      ];
    }
    const rectCollider = world.entities.getComponent(entityId, RectColliderComponent)!;
    return [
      position.x - rectCollider.halfWidth,
      position.y - rectCollider.halfHeight,
      position.x + rectCollider.halfWidth,
      position.y + rectCollider.halfHeight,
    ];
  }

  /** Layer/mask for whichever collider component (circle or rect) an entity has. */
  private layerMaskFor(world: World, entityId: EntityId): { layer: number; collidesWith: number } | undefined {
    const circleCollider = world.entities.getComponent(entityId, CircleColliderComponent);
    if (circleCollider) {
      return { layer: circleCollider.layer, collidesWith: circleCollider.collidesWith };
    }
    const rectCollider = world.entities.getComponent(entityId, RectColliderComponent);
    if (rectCollider) {
      return { layer: rectCollider.layer, collidesWith: rectCollider.collidesWith };
    }
    return undefined;
  }

  private testNarrowphase(world: World, a: EntityId, b: EntityId): CollisionManifold | null {
    const layerMaskA = this.layerMaskFor(world, a);
    const layerMaskB = this.layerMaskFor(world, b);
    if (
      layerMaskA &&
      layerMaskB &&
      !layersCollide(layerMaskA.layer, layerMaskA.collidesWith, layerMaskB.layer, layerMaskB.collidesWith)
    ) {
      return null;
    }

    const posA = world.entities.getComponent(a, PositionComponent)!;
    const posB = world.entities.getComponent(b, PositionComponent)!;
    const circleA = world.entities.getComponent(a, CircleColliderComponent);
    const circleB = world.entities.getComponent(b, CircleColliderComponent);
    const rectA = world.entities.getComponent(a, RectColliderComponent);
    const rectB = world.entities.getComponent(b, RectColliderComponent);

    if (circleA && circleB) {
      return testCircleCircle(posA.x, posA.y, circle(circleA.radius), posB.x, posB.y, circle(circleB.radius));
    }
    if (rectA && rectB) {
      return testRectRect(
        posA.x,
        posA.y,
        rect(rectA.halfWidth * 2, rectA.halfHeight * 2),
        posB.x,
        posB.y,
        rect(rectB.halfWidth * 2, rectB.halfHeight * 2),
      );
    }
    if (circleA && rectB) {
      return testCircleRect(
        posA.x,
        posA.y,
        circle(circleA.radius),
        posB.x,
        posB.y,
        rect(rectB.halfWidth * 2, rectB.halfHeight * 2),
      );
    }
    if (rectA && circleB) {
      // testCircleRect expects (circle, rect) order — swap, then flip the resulting
      // normal so it still points from `a` toward `b` as this system's contract requires.
      const manifold = testCircleRect(
        posB.x,
        posB.y,
        circle(circleB.radius),
        posA.x,
        posA.y,
        rect(rectA.halfWidth * 2, rectA.halfHeight * 2),
      );
      if (!manifold) {
        return null;
      }
      return { normal: { x: -manifold.normal.x, y: -manifold.normal.y }, depth: manifold.depth };
    }
    return null;
  }

  private resolvePair(world: World, a: EntityId, b: EntityId): void {
    const manifold = this.testNarrowphase(world, a, b);
    if (!manifold) {
      return;
    }

    const bodyA = world.entities.getComponent(a, PhysicsBodyComponent);
    const bodyB = world.entities.getComponent(b, PhysicsBodyComponent);
    const staticA = bodyA?.bodyType === 'static';
    const staticB = bodyB?.bodyType === 'static';

    if (staticA && staticB) {
      return; // two immovable objects overlapping — nothing to resolve.
    }

    const posA = world.entities.getComponent(a, PositionComponent)!;
    const posB = world.entities.getComponent(b, PositionComponent)!;
    const velA = world.entities.getComponent(a, VelocityComponent);
    const velB = world.entities.getComponent(b, VelocityComponent);

    const targetA = { x: posA.x, y: posA.y, vx: velA?.vx ?? 0, vy: velA?.vy ?? 0 };
    const targetB = { x: posB.x, y: posB.y, vx: velB?.vx ?? 0, vy: velB?.vy ?? 0 };

    separate(targetA, inverseMass(bodyA?.mass ?? 1, staticA), targetB, inverseMass(bodyB?.mass ?? 1, staticB), manifold);

    if (!staticA && velA) {
      slideAlongNormal(targetA, -manifold.normal.x, -manifold.normal.y);
    }
    if (!staticB && velB) {
      slideAlongNormal(targetB, manifold.normal.x, manifold.normal.y);
    }

    posA.x = targetA.x;
    posA.y = targetA.y;
    posB.x = targetB.x;
    posB.y = targetB.y;
    if (velA) {
      velA.vx = targetA.vx;
      velA.vy = targetA.vy;
    }
    if (velB) {
      velB.vx = targetB.vx;
      velB.vy = targetB.vy;
    }
  }
}
