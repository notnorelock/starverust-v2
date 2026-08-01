import { Migrator } from 'kysely';
import { createSqliteConnection } from './connection';
import { createKysely } from './kysely';
import { StaticMigrationProvider } from './migrations/index';
import { loadEnvConfig } from '../utils/EnvConfig';

async function main(): Promise<void> {
  const config = loadEnvConfig();
  const database = createSqliteConnection(config.sqlitePath);
  const db = createKysely(database);
  const migrator = new Migrator({ db, provider: new StaticMigrationProvider() });

  const { error, results } = await migrator.migrateToLatest();

  for (const result of results ?? []) {
    if (result.status === 'Success') {
      console.log(`[migrate] applied ${result.migrationName}`);
    } else if (result.status === 'Error') {
      console.error(`[migrate] FAILED ${result.migrationName}`);
    }
  }

  await db.destroy();

  if (error) {
    console.error('[migrate] migration run failed:', error);
    process.exit(1);
  }

  console.log('[migrate] up to date');
}

void main();
