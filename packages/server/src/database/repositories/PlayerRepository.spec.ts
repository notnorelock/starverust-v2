import { beforeEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import { Migrator, type Kysely } from 'kysely';
import { createKysely } from '../kysely';
import { StaticMigrationProvider } from '../migrations/index';
import type { DB } from '../types';
import { PlayerRepository } from './PlayerRepository';

describe('PlayerRepository', () => {
  let db: Kysely<DB>;
  let repository: PlayerRepository;

  beforeEach(async () => {
    const database = new Database(':memory:');
    db = createKysely(database);
    const migrator = new Migrator({ db, provider: new StaticMigrationProvider() });
    const { error } = await migrator.migrateToLatest();
    if (error) {
      throw error;
    }
    repository = new PlayerRepository(db);
  });

  it('creates a player and finds it by username', async () => {
    const created = await repository.create('alice');
    expect(created.id).toBeGreaterThan(0);
    expect(created.username).toBe('alice');
    expect(created.createdAt).toBeTruthy();

    const found = await repository.findByUsername('alice');
    expect(found).toEqual(created);
  });

  it('finds a player by id', async () => {
    const created = await repository.create('bob');
    const found = await repository.findById(created.id);
    expect(found).toEqual(created);
  });

  it('returns undefined for a non-existent player', async () => {
    expect(await repository.findByUsername('nobody')).toBeUndefined();
    expect(await repository.findById(9999)).toBeUndefined();
  });

  it('rejects duplicate usernames due to the unique constraint', async () => {
    await repository.create('duplicate');
    await expect(repository.create('duplicate')).rejects.toThrow();
  });
});
