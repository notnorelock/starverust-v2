import { System } from '../core/System';
import type { World } from '../core/World';
import type { ComponentType } from '../core/ComponentType';
import { PositionComponent } from '../components/PositionComponent';
import { VelocityComponent } from '../components/VelocityComponent';
import { PhysicsBodyComponent } from '../components/PhysicsBodyComponent';

const MIN_SPEED_SQUARED = 0.0001; // below this, snap velocity to exactly zero instead of decaying forever

/**
 * Pipeline step 3 (Physics): applies pending acceleration into velocity, then decays
 * velocity by friction and drag. Runs before MovementSystem (step 2 numerically, but this
 * system determines the velocity MovementSystem then integrates into position — see
 * TickPipeline for the actual registration order, which places this ahead of
 * MovementSystem despite the conceptual step numbers from the original 12-step list).
 *
 * Also records each dynamic body's pre-movement position into
 * PhysicsBodyComponent.prevX/prevY, BEFORE anything moves it this tick — CollisionSystem
 * (which runs after MovementSystem) uses that to measure the tick's actual displacement
 * and decide whether continuous collision (sub-stepping) is needed for a fast mover.
 *
 * Static bodies (PhysicsBodyComponent.bodyType === 'static') are skipped entirely — world
 * geometry/resources never move regardless of what's in their VelocityComponent.
 */
export class PhysicsSystem extends System {
  readonly query: ReadonlyArray<ComponentType> = [VelocityComponent, PhysicsBodyComponent];

  override onFixedUpdate(fixedDt: number, world: World): void {
    for (const entityId of world.entities.query(VelocityComponent, PhysicsBodyComponent)) {
      const velocity = world.entities.getComponent(entityId, VelocityComponent);
      const body = world.entities.getComponent(entityId, PhysicsBodyComponent);
      if (!velocity || !body || body.bodyType === 'static') {
        continue;
      }

      const position = world.entities.getComponent(entityId, PositionComponent);
      if (position) {
        body.prevX = position.x;
        body.prevY = position.y;
      }

      velocity.vx += body.ax * fixedDt;
      velocity.vy += body.ay * fixedDt;
      body.ax = 0;
      body.ay = 0;

      // Friction and drag both decay velocity multiplicatively per second; combine them
      // into one factor applied once rather than two sequential multiplications.
      const decay = Math.max(0, 1 - (body.friction + body.drag) * fixedDt);
      velocity.vx *= decay;
      velocity.vy *= decay;

      if (velocity.vx * velocity.vx + velocity.vy * velocity.vy < MIN_SPEED_SQUARED) {
        velocity.vx = 0;
        velocity.vy = 0;
      }
    }
  }
}
