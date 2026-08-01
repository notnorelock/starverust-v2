import { Logger } from '@starve/shared';
import { loadEnvConfig } from '../utils/EnvConfig';
import { createSqliteConnection } from '../database/connection';
import { createKysely } from '../database/kysely';
import { GameServer } from '../core/GameServer';
import { DEFAULT_WORLD_CONFIG } from '../world/WorldConfig';

const logger = new Logger('ServerBootstrap');

export function bootstrapServer(): GameServer {
  const config = loadEnvConfig();
  // Stage 1 has no map editor/loader yet, so this instance runs the default world
  // config. A later stage swaps this for loading a map file per regional instance —
  // GameServer, TickPipeline, and PlayerSession all already take WorldConfig/WorldBounds
  // as constructor/parameter input rather than importing a shared constant, specifically
  // so that swap doesn't touch them.
  const worldConfig = DEFAULT_WORLD_CONFIG;
  logger.info(
    `Starting with config: port=${config.port} tickRate=${config.tickRate} world=${worldConfig.width}x${worldConfig.height}`,
  );

  const database = createSqliteConnection(config.sqlitePath);
  const db = createKysely(database);

  const server = new GameServer(config, db, worldConfig);
  server.start();

  const shutdown = (): void => {
    logger.info('Shutting down...');
    server.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}
