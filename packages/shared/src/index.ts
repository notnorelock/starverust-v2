// ECS core
export { Entity } from './ecs/core/Entity';
export type { EntityId } from './ecs/core/EntityId';
export { Component } from './ecs/core/Component';
export type { ComponentType } from './ecs/core/ComponentType';
export { System } from './ecs/core/System';
export { World } from './ecs/core/World';
export type { WorldOptions } from './ecs/core/World';
export { EntityRegistry } from './ecs/core/EntityRegistry';
export { ComponentStore } from './ecs/core/ComponentStore';
export type { Query } from './ecs/core/Query';
export type { IInitializable, IUpdatable, IFixedUpdatable, IDestructible } from './ecs/core/lifecycle';

// ECS components & systems
export * from './ecs/components';
export * from './ecs/systems';

// DI
export { ServiceContainer, createServiceKey, ServiceNotFoundError } from './di/ServiceContainer';
export type { ServiceKey } from './di/ServiceContainer';
export { SystemClockService } from './di/ClockService';
export type { ClockService } from './di/ClockService';
export { CLOCK_SERVICE } from './di/ServiceKeys';

// Math
export * as Vector2 from './math/Vector2';
export type { Vector2 as Vector2Type } from './math/Vector2';
export * as MathUtils from './math/MathUtils';
export {
  Ease,
  Ease2D,
  easeOutQuad,
  easeOutCubic,
  easeInOutQuad,
  easeInOutCubic,
  easeInOutQuart,
  easeOutQuart,
  easeOutQuint,
} from './math/Easing';
export type { EasingFunction } from './math/Easing';
export type { WorldBounds } from './math/WorldBounds';

// Physics
export * from './physics';

// Time
export { FixedTimestepLoop } from './time/FixedTimestepLoop';
export type { FixedTimestepLoopOptions, TickCallback } from './time/FixedTimestepLoop';

// Constants
export * from './constants/GameConstants';

// Utils
export { Logger, LogLevel } from './utils/Logger';
