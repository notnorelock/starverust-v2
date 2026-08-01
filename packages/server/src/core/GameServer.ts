import { FixedTimestepLoop, Logger, World } from '@starve/shared';
import type { Kysely } from 'kysely';
import type { EnvConfig } from '../utils/EnvConfig';
import { createServerWorld } from '../world/ServerWorldFactory';
import { WebSocketGateway } from '../network/WebSocketGateway';
import { ConnectionRegistry } from '../network/ConnectionRegistry';
import { PacketRouter } from '../network/PacketRouter';
import type { ClientConnection } from '../network/ClientConnection';
import { PlayerRepository } from '../database/repositories/PlayerRepository';
import { onConnectionClosed, onConnectionEstablished } from '../players/PlayerSession';
import { EventBus } from '../events/EventBus';
import { buildTickPipeline } from './TickPipeline';
import { NETWORK_SERVICE, CONNECTION_REGISTRY, PLAYER_REPOSITORY, EVENT_BUS } from './ServiceKeys';
import type { DB } from '../database/types';
import { boundsFromConfig, type WorldConfig } from '../world/WorldConfig';

const logger = new Logger('GameServer');

/**
 * Composition root for a single game server instance. Deliberately holds no module-level
 * singleton state — every dependency is constructed and owned here — so a future stage
 * can run multiple independent regional instances of this same class side by side behind
 * a separate master/matchmaking service without any refactor to this class itself. Takes
 * its own WorldConfig, so each instance can run a differently-sized/shaped world.
 */
export class GameServer {
  private readonly world: World;
  private readonly loop: FixedTimestepLoop;
  private readonly gateway: WebSocketGateway;
  private readonly connectionRegistry = new ConnectionRegistry();

  constructor(
    private readonly config: EnvConfig,
    private readonly db: Kysely<DB>,
    private readonly worldConfig: WorldConfig,
  ) {
    this.world = createServerWorld();
    const worldBounds = boundsFromConfig(this.worldConfig);

    const playerRepository = new PlayerRepository(this.db);
    this.world.services.register(CONNECTION_REGISTRY, this.connectionRegistry);
    this.world.services.register(PLAYER_REPOSITORY, playerRepository);
    this.world.services.register(EVENT_BUS, new EventBus());

    this.gateway = new WebSocketGateway({
      port: config.port,
      connectionRegistry: this.connectionRegistry,
      packetRouter: new PacketRouter(),
      onConnect: (connection) => this.handleConnect(connection),
      onDisconnect: (connection) => this.handleDisconnect(connection),
    });
    this.world.services.register(NETWORK_SERVICE, this.gateway);

    for (const system of buildTickPipeline(this.world.services, worldBounds)) {
      this.world.registerSystem(system);
    }

    this.loop = new FixedTimestepLoop({
      tickRate: config.tickRate,
      onTick: (fixedDt) => this.world.fixedUpdate(fixedDt),
    });
  }

  start(): void {
    this.world.init();
    this.gateway.start();
    this.loop.start();
    logger.info(
      `Tick loop started at ${this.config.tickRate} TPS, world ${this.worldConfig.width}x${this.worldConfig.height}`,
    );
  }

  stop(): void {
    this.loop.stop();
    this.gateway.stop();
    this.world.destroy();
  }

  private handleConnect(connection: ClientConnection): void {
    const playerRepository = this.world.services.resolve(PLAYER_REPOSITORY);
    const worldBounds = boundsFromConfig(this.worldConfig);
    void onConnectionEstablished(
      connection,
      this.world,
      playerRepository,
      this.config.tickRate,
      this.worldConfig,
      worldBounds,
    );
  }

  private handleDisconnect(connection: ClientConnection): void {
    onConnectionClosed(connection, this.world);
  }
}
