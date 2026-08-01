export enum LogLevel {
  Debug = 0,
  Info = 1,
  Warn = 2,
  Error = 3,
}

/**
 * Minimal namespaced logger. Concrete transport is console today; kept behind an
 * interface-free thin wrapper so a future stage can redirect to a structured sink
 * without touching call sites.
 */
export class Logger {
  constructor(
    private readonly namespace: string,
    private readonly minLevel: LogLevel = LogLevel.Debug,
  ) {}

  debug(message: string, ...args: unknown[]): void {
    this.log(LogLevel.Debug, message, args);
  }

  info(message: string, ...args: unknown[]): void {
    this.log(LogLevel.Info, message, args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.log(LogLevel.Warn, message, args);
  }

  error(message: string, ...args: unknown[]): void {
    this.log(LogLevel.Error, message, args);
  }

  private log(level: LogLevel, message: string, args: unknown[]): void {
    if (level < this.minLevel) {
      return;
    }
    const prefix = `[${LogLevel[level]}] [${this.namespace}]`;
    switch (level) {
      case LogLevel.Error:
        console.error(prefix, message, ...args);
        break;
      case LogLevel.Warn:
        console.warn(prefix, message, ...args);
        break;
      default:
        console.log(prefix, message, ...args);
    }
  }
}
