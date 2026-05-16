/**
 * Persistent Memory Database for Gate-MCP (v0.5.2).
 *
 * Backs gate_memory with the same SQLite file as the dedup cache
 * (`.gate-mcp/cache.db`) so agent KV data survives restarts and concurrent
 * IDEs use WAL safely. When better-sqlite3 is unavailable, falls back to
 * `.gate-mcp/memory.json` (same behavior as pre-0.5.2).
 *
 * One-time migration: if memory.json exists and the SQLite table is empty,
 * keys are imported and the file is renamed to memory.json.migrated.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { Database as BetterSqliteDatabase, Statement } from "better-sqlite3";
import { safeResolve } from "./pathGuard.js";
import logger from "./logger.js";

const require = createRequire(import.meta.url);

const MEMORY_DIR = ".gate-mcp";
const MEMORY_FILE = "memory.json";
const MEMORY_MIGRATED = "memory.json.migrated";

/** Cap KV rows (keys are small agent notes, not file bodies). */
export const MAX_MEMORY_ENTRIES = 2_000;
/** Cap total stored value bytes (~10 MB). */
export const MAX_MEMORY_BYTES = 10 * 1024 * 1024;

type SqlMemState = {
  kind: "sqlite";
  db: BetterSqliteDatabase;
  path: string;
  stmtGet: Statement;
  stmtPut: Statement;
  stmtDelete: Statement;
  stmtClear: Statement;
  stmtCount: Statement;
  stmtList: Statement;
  stmtSumBytes: Statement;
  stmtEvictOldest: Statement;
};

type JsonMemState = {
  kind: "json";
  path: string;
};

let state: SqlMemState | JsonMemState | null = null;
let migrationDone = false;

function resolveDbPath(): string {
  const fromEnv = process.env.GATE_CACHE_DB;
  if (fromEnv && fromEnv.trim().length > 0) {
    return safeResolve(fromEnv, { caller: "memoryDb" });
  }
  const root = process.env.GATE_PROJECT_ROOT ?? process.cwd();
  return safeResolve(path.join(root, MEMORY_DIR, "cache.db"), {
    caller: "memoryDb",
  });
}

function jsonMemoryPath(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), MEMORY_DIR, MEMORY_FILE);
}

function tryOpenSqlite(): SqlMemState | null {
  let Database: typeof import("better-sqlite3");
  try {
    Database = require("better-sqlite3");
  } catch {
    return null;
  }

  let dbPath: string;
  try {
    dbPath = resolveDbPath();
  } catch {
    return null;
  }

  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.exec(
      `CREATE TABLE IF NOT EXISTS memory_entries (
         mem_key    TEXT PRIMARY KEY,
         value      TEXT NOT NULL,
         updated_at INTEGER NOT NULL
       );
       CREATE INDEX IF NOT EXISTS idx_memory_updated ON memory_entries(updated_at);`
    );

    const stmtGet = db.prepare(
      `SELECT value FROM memory_entries WHERE mem_key = ?`
    );
    const stmtPut = db.prepare(
      `INSERT INTO memory_entries (mem_key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(mem_key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`
    );
    const stmtDelete = db.prepare(
      `DELETE FROM memory_entries WHERE mem_key = ?`
    );
    const stmtClear = db.prepare(`DELETE FROM memory_entries`);
    const stmtCount = db.prepare(
      `SELECT COUNT(*) AS n FROM memory_entries`
    );
    const stmtList = db.prepare(
      `SELECT mem_key AS key, LENGTH(value) AS length
         FROM memory_entries ORDER BY updated_at DESC`
    );
    const stmtSumBytes = db.prepare(
      `SELECT COALESCE(SUM(LENGTH(value)), 0) AS s FROM memory_entries`
    );
    const stmtEvictOldest = db.prepare(
      `DELETE FROM memory_entries
         WHERE mem_key IN (
           SELECT mem_key FROM memory_entries
           ORDER BY updated_at ASC
           LIMIT ?
         )`
    );

    logger.info(`memoryDb: SQLite memory opened at ${dbPath}`);
    return {
      kind: "sqlite",
      db,
      path: dbPath,
      stmtGet,
      stmtPut,
      stmtDelete,
      stmtClear,
      stmtCount,
      stmtList,
      stmtSumBytes,
      stmtEvictOldest,
    };
  } catch (err) {
    logger.warn(
      `memoryDb: SQLite unavailable, using JSON fallback: ${
        err instanceof Error ? err.message : err
      }`
    );
    return null;
  }
}

function ensureState(projectRoot: string): SqlMemState | JsonMemState {
  if (state) {
    maybeMigrateJsonToSqlite(projectRoot);
    return state;
  }
  const sql = tryOpenSqlite();
  if (sql) {
    state = sql;
  } else {
    state = { kind: "json", path: jsonMemoryPath(projectRoot) };
    logger.info(`memoryDb: using ${MEMORY_DIR}/${MEMORY_FILE} (no SQLite)`);
  }
  maybeMigrateJsonToSqlite(projectRoot);
  return state;
}

function maybeMigrateJsonToSqlite(projectRoot: string): void {
  if (migrationDone || !state || state.kind !== "sqlite") return;
  migrationDone = true;

  const jsonPath = jsonMemoryPath(projectRoot);
  if (!fs.existsSync(jsonPath)) return;

  const count = (state.stmtCount.get() as { n: number }).n;
  if (count > 0) return;

  let store: Record<string, string>;
  try {
    store = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as Record<string, string>;
  } catch (err) {
    logger.warn(`memoryDb: skip migration, invalid ${MEMORY_FILE}: ${err}`);
    return;
  }

  const keys = Object.keys(store);
  if (keys.length === 0) return;

  const now = Date.now();
  for (const key of keys) {
    state.stmtPut.run(key, store[key], now);
  }
  enforceLruSqlite(state);

  const migratedPath = path.join(path.dirname(jsonPath), MEMORY_MIGRATED);
  try {
    fs.renameSync(jsonPath, migratedPath);
    logger.info(
      `memoryDb: migrated ${keys.length} entries from ${MEMORY_FILE} → SQLite (${migratedPath})`
    );
  } catch (err) {
    logger.warn(`memoryDb: migrated to SQLite but could not rename JSON: ${err}`);
  }
}

function enforceLruSqlite(s: SqlMemState): void {
  const count = (s.stmtCount.get() as { n: number }).n;
  if (count > MAX_MEMORY_ENTRIES) {
    s.stmtEvictOldest.run(count - MAX_MEMORY_ENTRIES);
  }
  let bytes = Number((s.stmtSumBytes.get() as { s: number | bigint }).s);
  let safety = 50;
  while (bytes > MAX_MEMORY_BYTES && safety-- > 0) {
    s.stmtEvictOldest.run(Math.max(1, Math.floor(MAX_MEMORY_ENTRIES / 20)));
    bytes = Number((s.stmtSumBytes.get() as { s: number | bigint }).s);
  }
}

function loadJsonStore(jsonPath: string): Record<string, string> {
  try {
    if (fs.existsSync(jsonPath)) {
      return JSON.parse(fs.readFileSync(jsonPath, "utf8")) as Record<string, string>;
    }
  } catch (err) {
    logger.warn(`memoryDb: failed to load JSON memory: ${err}`);
  }
  return {};
}

function saveJsonStore(jsonPath: string, store: Record<string, string>): void {
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(store, null, 2), "utf8");
}

/** True when gate_memory uses SQLite (same file as dedup cache). */
export function isMemoryPersistent(projectRoot?: string): boolean {
  ensureState(projectRoot ?? process.cwd());
  return state?.kind === "sqlite";
}

export function memoryBackendLabel(projectRoot?: string): string {
  const s = ensureState(projectRoot ?? process.cwd());
  return s.kind === "sqlite" ? `SQLite (${s.path})` : `JSON (${s.path})`;
}

export function memoryGet(
  projectRoot: string,
  key: string
): string | undefined {
  const s = ensureState(projectRoot);
  if (s.kind === "sqlite") {
    const row = s.stmtGet.get(key) as { value: string } | undefined;
    return row?.value;
  }
  return loadJsonStore(s.path)[key];
}

export function memoryPut(
  projectRoot: string,
  key: string,
  value: string
): number {
  const s = ensureState(projectRoot);
  if (s.kind === "sqlite") {
    s.stmtPut.run(key, value, Date.now());
    enforceLruSqlite(s);
    return (s.stmtCount.get() as { n: number }).n;
  }
  const store = loadJsonStore(s.path);
  store[key] = value;
  saveJsonStore(s.path, store);
  return Object.keys(store).length;
}

export function memoryDelete(
  projectRoot: string,
  key: string
): { deleted: boolean; count: number } {
  const s = ensureState(projectRoot);
  if (s.kind === "sqlite") {
    const info = s.stmtDelete.run(key);
    return {
      deleted: info.changes > 0,
      count: (s.stmtCount.get() as { n: number }).n,
    };
  }
  const store = loadJsonStore(s.path);
  const deleted = key in store;
  if (deleted) delete store[key];
  saveJsonStore(s.path, store);
  return { deleted, count: Object.keys(store).length };
}

export function memoryClear(projectRoot: string): number {
  const s = ensureState(projectRoot);
  if (s.kind === "sqlite") {
    const before = (s.stmtCount.get() as { n: number }).n;
    s.stmtClear.run();
    return before;
  }
  const store = loadJsonStore(s.path);
  const before = Object.keys(store).length;
  saveJsonStore(s.path, {});
  return before;
}

export function memoryCount(projectRoot: string): number {
  const s = ensureState(projectRoot);
  if (s.kind === "sqlite") {
    return (s.stmtCount.get() as { n: number }).n;
  }
  return Object.keys(loadJsonStore(s.path)).length;
}

export function memoryList(
  projectRoot: string
): Array<{ key: string; length: number }> {
  const s = ensureState(projectRoot);
  if (s.kind === "sqlite") {
    return s.stmtList.all() as Array<{ key: string; length: number }>;
  }
  const store = loadJsonStore(s.path);
  return Object.keys(store).map((key) => ({
    key,
    length: store[key]?.length ?? 0,
  }));
}

/** Reset module state (tests only). */
export function _resetMemoryDbForTests(): void {
  if (state?.kind === "sqlite") {
    try {
      state.db.close();
    } catch {
      /* ignore */
    }
  }
  state = null;
  migrationDone = false;
}
