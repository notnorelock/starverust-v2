import type { Migration, MigrationProvider } from 'kysely';
import * as migration0001 from './0001_create_players_table';

/**
 * Statically-registered migration provider. Preferred over Kysely's FileMigrationProvider
 * (which does directory reads + dynamic import()) so migrations are bundler/Bun-friendly
 * and their existence is checked at compile time — add a new migration by importing it
 * here, matching numbered/timestamp-prefixed filename convention.
 */
export class StaticMigrationProvider implements MigrationProvider {
  private readonly migrations: Record<string, Migration> = {
    '0001_create_players_table': migration0001,
  };

  async getMigrations(): Promise<Record<string, Migration>> {
    return this.migrations;
  }
}
