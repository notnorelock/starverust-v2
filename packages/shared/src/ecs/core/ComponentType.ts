import type { Component } from './Component';

/** A constructible component class, used as a registry/query key. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ComponentType<T extends Component = Component> = new (...args: any[]) => T;
