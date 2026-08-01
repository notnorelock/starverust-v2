import type { Database, SQLQueryBindings } from 'bun:sqlite';
import {
  CompiledQuery,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  SelectQueryNode,
  type Dialect,
  type Driver,
  type DatabaseConnection,
  type QueryResult,
  type Kysely,
  type QueryCompiler,
  type DialectAdapter,
  type DatabaseIntrospector,
  type RootOperationNode,
} from 'kysely';

/**
 * Hand-rolled Kysely Dialect targeting Bun's built-in `bun:sqlite` module.
 *
 * Reuses Kysely's own SqliteQueryCompiler/SqliteAdapter/SqliteIntrospector (the SQL
 * dialect itself doesn't change) and supplies only a bun:sqlite-flavored Driver, since
 * bun:sqlite's Statement API is close to but not identical to better-sqlite3's — notably
 * it lacks a `reader` flag, so this driver detects SELECT vs write queries structurally
 * from the compiled query's operation node instead.
 */
export class BunSqliteDialect implements Dialect {
  constructor(private readonly config: { database: Database }) {}

  createDriver(): Driver {
    return new BunSqliteDriver(this.config.database);
  }

  createQueryCompiler(): QueryCompiler {
    return new SqliteQueryCompiler();
  }

  createAdapter(): DialectAdapter {
    return new SqliteAdapter();
  }

  createIntrospector(db: Kysely<unknown>): DatabaseIntrospector {
    return new SqliteIntrospector(db);
  }
}

class BunSqliteDriver implements Driver {
  private readonly connection: BunSqliteConnection;
  private mutexQueue: Promise<void> = Promise.resolve();

  constructor(private readonly database: Database) {
    this.connection = new BunSqliteConnection(database);
  }

  async init(): Promise<void> {
    // bun:sqlite opens synchronously in createSqliteConnection(); nothing to do here.
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    // bun:sqlite is a single-connection, synchronous engine — serialize access
    // with a promise-chain mutex, mirroring Kysely's own SqliteDriver strategy.
    let release!: () => void;
    const previous = this.mutexQueue;
    this.mutexQueue = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    (this.connection as { release?: () => void }).release = release;
    return this.connection;
  }

  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('begin'));
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('commit'));
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('rollback'));
  }

  async releaseConnection(): Promise<void> {
    const release = (this.connection as { release?: () => void }).release;
    release?.();
  }

  async destroy(): Promise<void> {
    this.database.close();
  }
}

class BunSqliteConnection implements DatabaseConnection {
  constructor(private readonly database: Database) {}

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    const { sql, parameters, query } = compiledQuery;
    const stmt = this.database.prepare(sql);
    // Plain SELECTs always return rows; INSERT/UPDATE/DELETE only return rows when they
    // carry a RETURNING clause (Kysely's .returningAll()/.returning() API) — both cases
    // need stmt.all() instead of stmt.run(), which reports affected-row counts but no rows.
    const returnsRows = SelectQueryNode.is(query) || hasReturningClause(query);

    // Kysely's compiled parameters are `readonly unknown[]` at the type level, but every
    // runtime value is one of bun:sqlite's supported bind types (string/number/bigint/
    // boolean/null/typed-array) — SQLQueryBindings can't be narrowed statically here.
    const bindings = parameters as SQLQueryBindings[];

    if (returnsRows) {
      const rows = stmt.all(...bindings) as R[];
      return { rows };
    }

    const result = stmt.run(...bindings);
    return {
      numAffectedRows: BigInt(result.changes ?? 0),
      insertId: result.lastInsertRowid !== undefined ? BigInt(result.lastInsertRowid) : undefined,
      rows: [],
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('BunSqliteDriver does not support streaming queries in Stage 1');
  }
}

function hasReturningClause(query: RootOperationNode): boolean {
  return 'returning' in query && query.returning !== undefined;
}
