import type { Kysely } from 'kysely';
import type { DB } from '../types';
import type { IPlayerRepository, PlayerRecord } from './IPlayerRepository';

/**
 * All SQL for the `players` table is isolated here — game logic depends only on
 * IPlayerRepository, never on Kysely directly, so dialect-specific quirks (SQLite vs
 * the future PostgreSQL swap) stay contained to this one class.
 */
export class PlayerRepository implements IPlayerRepository {
  constructor(private readonly db: Kysely<DB>) {}

  async findById(id: number): Promise<PlayerRecord | undefined> {
    const row = await this.db.selectFrom('players').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? toRecord(row) : undefined;
  }

  async findByUsername(username: string): Promise<PlayerRecord | undefined> {
    const row = await this.db
      .selectFrom('players')
      .selectAll()
      .where('username', '=', username)
      .executeTakeFirst();
    return row ? toRecord(row) : undefined;
  }

  async create(username: string): Promise<PlayerRecord> {
    const row = await this.db
      .insertInto('players')
      .values({ username })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toRecord(row);
  }
}

function toRecord(row: { id: number; username: string; created_at: string }): PlayerRecord {
  return { id: row.id, username: row.username, createdAt: row.created_at };
}
