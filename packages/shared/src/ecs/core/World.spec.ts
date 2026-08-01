import { describe, expect, it } from 'vitest';
import { World } from './World';
import { System } from './System';
import type { ComponentType } from './ComponentType';
import { ServiceContainer } from '../../di/ServiceContainer';

class OrderRecordingSystem extends System {
  readonly query: ReadonlyArray<ComponentType> = [];
  constructor(
    public readonly label: string,
    private readonly initLog: string[],
    private readonly fixedUpdateLog: string[],
  ) {
    super();
  }
  override onInit(): void {
    this.initLog.push(this.label);
  }
  override onFixedUpdate(): void {
    this.fixedUpdateLog.push(this.label);
  }
}

class DisabledTrackingSystem extends System {
  readonly query: ReadonlyArray<ComponentType> = [];
  calls = 0;
  override onFixedUpdate(): void {
    this.calls += 1;
  }
}

function createWorld(): World {
  return new World({ services: new ServiceContainer() });
}

describe('World', () => {
  it('calls onInit on every registered system exactly once, in registration order', () => {
    const initLog: string[] = [];
    const fixedUpdateLog: string[] = [];
    const world = createWorld();
    world.registerSystem(new OrderRecordingSystem('first', initLog, fixedUpdateLog));
    world.registerSystem(new OrderRecordingSystem('second', initLog, fixedUpdateLog));

    world.init();

    expect(initLog).toEqual(['first', 'second']);
  });

  it('fixedUpdate invokes onFixedUpdate on each system in registration order', () => {
    const initLog: string[] = [];
    const fixedUpdateLog: string[] = [];
    const world = createWorld();
    world.registerSystem(new OrderRecordingSystem('first', initLog, fixedUpdateLog));
    world.registerSystem(new OrderRecordingSystem('second', initLog, fixedUpdateLog));
    world.init();

    world.fixedUpdate(1 / 30);

    expect(fixedUpdateLog).toEqual(['first', 'second']);
  });

  it('skips disabled systems during fixedUpdate', () => {
    const world = createWorld();
    const system = new DisabledTrackingSystem();
    world.registerSystem(system);
    world.init();

    system.enabled = false;
    world.fixedUpdate(1 / 30);

    expect(system.calls).toBe(0);
  });

  it('getSystem returns the registered instance of the requested type', () => {
    const world = createWorld();
    const system = new DisabledTrackingSystem();
    world.registerSystem(system);

    expect(world.getSystem(DisabledTrackingSystem)).toBe(system);
  });

  it('getSystem returns undefined when no system of that type is registered', () => {
    const world = createWorld();
    expect(world.getSystem(DisabledTrackingSystem)).toBeUndefined();
  });
});
