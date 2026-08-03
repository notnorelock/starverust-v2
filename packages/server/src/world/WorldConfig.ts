import type { WorldBounds } from '@starve/shared';

/**
 * Per-instance world configuration. Deliberately shaped like a small map-definition
 * document (not scattered env vars) — this is the type a future map editor would export,
 * and different regional GameServer instances can each load their own WorldConfig to run
 * differently-sized/shaped worlds without any code change.
 */
export interface WorldConfig {
  readonly width: number;
  readonly height: number;
  readonly spawnX: number;
  readonly spawnY: number;
}

export function boundsFromConfig(config: WorldConfig): WorldBounds {
  return {
    minX: -config.width / 2,
    maxX: config.width / 2,
    minY: -config.height / 2,
    maxY: config.height / 2,
  };
}

/**
 * Stage 1's only world: a fixed 50x50 unit square centered on the origin, spawn at
 * center. Later stages load this from a map file/editor export instead of a constant;
 * GameServer takes a WorldConfig in its constructor specifically so that swap doesn't
 * touch any system or the tick pipeline.
 */
export const DEFAULT_WORLD_CONFIG: WorldConfig = {
  width: 5000,
  height: 5000,
  spawnX: 0,
  spawnY: 0,
};
