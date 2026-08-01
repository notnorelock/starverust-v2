import type { Generated } from 'kysely';

export interface PlayersTable {
  id: Generated<number>;
  username: string;
  created_at: Generated<string>;
}

/** Kysely's typed view of the schema. Dialect (SQLite today, Postgres in prod) is swappable
 *  independently of this interface — repositories only ever depend on `Kysely<DB>`. */
export interface DB {
  players: PlayersTable;
}
