import { DEFAULT_TICK_RATE } from '@starve/shared';

export interface EnvConfig {
  readonly port: number;
  readonly tickRate: number;
  readonly sqlitePath: string;
}

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadEnvConfig(): EnvConfig {
  return {
    port: readInt('PORT', 8081),
    tickRate: readInt('TICK_RATE', DEFAULT_TICK_RATE),
    sqlitePath: process.env.SQLITE_PATH ?? 'packages/server/data/dev.sqlite',
  };
}
