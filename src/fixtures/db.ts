import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

// Both a static `import` and a runtime `require` of the experimental node:sqlite builtin
// trip Playwright's TS module loader (its load hook returns a null source). process
// .getBuiltinModule fetches the builtin directly, bypassing the loader entirely; the
// `import type` above is erased at runtime, so it never reaches the loader either.
const { DatabaseSync: SqliteDatabase } =
  process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');

// The pinned container_name in docker-compose.yml. Using `docker cp` against the
// container name (rather than `docker compose cp` against the service) keeps this
// helper independent of the current working directory and the compose-file location.
const CONTAINER = 'juiceshop';
const CONTAINER_DB_PATH = '/juice-shop/data/juiceshop.sqlite';

/** Values accepted as bound parameters by node:sqlite prepared statements. */
type SqlParam = null | number | bigint | string | Uint8Array;

/** Read-only query access to a snapshot copy of Juice Shop's SQLite database. */
export interface JuiceShopDb {
  /** Run a SELECT and return every row. Params bind to positional `?` placeholders. */
  query<T = Record<string, unknown>>(sql: string, ...params: SqlParam[]): T[];
  /**
   * Discard the current snapshot so the next `query()` re-copies the live database.
   * Use after a write when asserting the DB reflects it (three-way consistency checks).
   */
  refresh(): void;
}

/** A {@link JuiceShopDb} plus the teardown hook the fixture owns. */
export interface JuiceShopDbHandle extends JuiceShopDb {
  /** Close the open snapshot (if any) and delete the temp copy. Idempotent. */
  dispose(): void;
}

class JuiceShopDbImpl implements JuiceShopDbHandle {
  #dir: string | undefined;
  #database: DatabaseSync | undefined;

  // Copies the live DB out of the container and opens the copy read-only. We never
  // bind-mount or touch the live file, so reading a private copy cannot contend with
  // the app -- there is structurally no "database is locked".
  #snapshot(): DatabaseSync {
    if (this.#database) return this.#database;

    const dir = mkdtempSync(join(tmpdir(), 'juiceshop-db-'));
    this.#dir = dir;
    const dest = join(dir, 'juiceshop.sqlite');
    try {
      try {
        execFileSync('docker', ['cp', `${CONTAINER}:${CONTAINER_DB_PATH}`, dest], {
          stdio: 'pipe',
        });
      } catch (err) {
        const stderr = (err as { stderr?: Buffer }).stderr?.toString().trim();
        throw new Error(
          `docker cp ${CONTAINER}:${CONTAINER_DB_PATH} failed: ${stderr || String(err)}`,
          { cause: err },
        );
      }

      const database = new SqliteDatabase(dest, { readOnly: true });

      // Juice Shop's Sequelize SQLite runs in rollback-journal mode, so the main file
      // is authoritative and a read-only copy is complete. If a future version ever
      // switches to WAL, a main-file-only read-only copy would miss un-checkpointed
      // writes -- fail loudly rather than return stale data.
      const mode = database.prepare('PRAGMA journal_mode').get() as {
        journal_mode?: string;
      };
      if (mode.journal_mode?.toLowerCase() === 'wal') {
        database.close();
        throw new Error(
          'Copied database is in WAL mode; a read-only copy of the main file is ' +
            'incomplete. Open the disposable copy read-write, or also copy -wal/-shm.',
        );
      }

      this.#database = database;
      return database;
    } catch (err) {
      // Setup failed before we handed anything back; clean up the temp dir.
      this.dispose();
      throw err;
    }
  }

  query<T = Record<string, unknown>>(sql: string, ...params: SqlParam[]): T[] {
    return this.#snapshot().prepare(sql).all(...params) as T[];
  }

  refresh(): void {
    this.dispose();
  }

  dispose(): void {
    if (this.#database?.isOpen) this.#database.close();
    this.#database = undefined;
    if (this.#dir) {
      rmSync(this.#dir, { recursive: true, force: true });
      this.#dir = undefined;
    }
  }
}

/**
 * Opens a lazy, read-only view of Juice Shop's SQLite database. The first `query()`
 * copies the live file out of the container with `docker cp` and opens the copy
 * read-only; `dispose()` closes it and removes the temp copy.
 */
export function openJuiceShopDb(): JuiceShopDbHandle {
  return new JuiceShopDbImpl();
}
