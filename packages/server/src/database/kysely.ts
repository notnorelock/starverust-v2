import type { Database } from 'bun:sqlite';
import { Kysely } from 'kysely';
import { BunSqliteDialect } from './BunSqliteDialect';
import type { DB } from './types';

export function createKysely(database: Database): Kysely<DB> {
  return new Kysely<DB>({
    dialect: new BunSqliteDialect({ database }),
  });
}
