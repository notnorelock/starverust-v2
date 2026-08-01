/**
 * Thin wrapper over a time source. Injecting this (rather than calling
 * performance.now()/Date.now() directly from systems) keeps time-dependent
 * logic deterministically testable.
 */
export interface ClockService {
  now(): number;
}

export class SystemClockService implements ClockService {
  now(): number {
    return performance.now();
  }
}
