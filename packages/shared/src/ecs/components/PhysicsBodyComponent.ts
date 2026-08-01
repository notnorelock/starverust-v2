import { Component } from '../core/Component';
import type { EntityId } from '../core/EntityId';

export type BodyType = 'dynamic' | 'static';

/**
 * Physical properties driving PhysicsSystem's integration and CollisionSystem's
 * resolution. Complements VelocityComponent (which just holds current vx/vy) — this
 * holds the *forces acting on* velocity: pending acceleration, mass (for knockback/push
 * response), and the friction/drag coefficients that decay velocity over time.
 *
 * `bodyType: 'static'` entities (world geometry, resources, obstacles) are collided
 * against but never moved by collision resolution or PhysicsSystem's integration —
 * CollisionSystem pushes only the dynamic side of a dynamic-vs-static pair.
 */
export class PhysicsBodyComponent extends Component {
  bodyType: BodyType;
  /** kg-equivalent; heavier bodies push lighter ones further in dynamic-vs-dynamic resolution. */
  mass: number;
  /** Pending acceleration for this tick, in world units/s^2; PhysicsSystem applies then resets it to 0. */
  ax = 0;
  ay = 0;
  /** Ground friction: fraction of velocity removed per second while no acceleration is applied (0..1). */
  friction: number;
  /** Air/fluid drag: velocity-proportional deceleration applied every tick regardless of input (0..1). */
  drag: number;
  /**
   * World-space position at the START of the current tick, before MovementSystem
   * integrates velocity into it — CollisionSystem compares this against the post-movement
   * position to detect this tick's displacement and decide whether continuous collision
   * (sub-stepping) is needed for a fast mover. Written by PhysicsSystem at the start of
   * each tick, before integration; not meant to be read/written by anything else.
   */
  prevX: number;
  prevY: number;

  constructor(
    entityId: EntityId,
    options: {
      bodyType?: BodyType;
      mass?: number;
      friction?: number;
      drag?: number;
      /**
       * The entity's actual spawn position — seeds prevX/prevY so the FIRST tick this
       * body exists in never sees a false "huge displacement" from the field's zero
       * default to wherever the entity actually spawned (which would otherwise make
       * CollisionSystem's continuous-collision pass try to sweep a stationary new entity
       * across the whole map on its very first tick). Omit only for a body that's
       * genuinely spawning at the origin.
       */
      initialX?: number;
      initialY?: number;
    } = {},
  ) {
    super(entityId);
    this.bodyType = options.bodyType ?? 'dynamic';
    this.mass = options.mass ?? 1;
    this.friction = options.friction ?? 0.1;
    this.drag = options.drag ?? 0.02;
    this.prevX = options.initialX ?? 0;
    this.prevY = options.initialY ?? 0;
  }
}
