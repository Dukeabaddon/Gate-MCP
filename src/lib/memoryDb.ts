/** Project-isolated gate_memory storage with SQLite and atomic JSON fallback. */

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
const MEMORY_TABLE = "memory_entries_v2";
const JSON_FORMAT_VERSION = 1;
const LOCK_STALE_MS = 30_000;
const LOCK_ATTEMPTS = 100;

export const MAX_MEMORY_ENTRIES = 2_000;
export const MAX_MEMORY_BYTES = 10 * 1024 * 1024;

type SqlMemState = {
  kind: "sqlite";
  root: string;
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
  root: string;
  path: string;
  fallbackReason: string;
};

type MemoryState = SqlMemState | JsonMemState;

interface JsonEntry {
  value: string;
  updatedAt: number;
}

interface JsonPayload {
  version: number;
  entries: Record<string, JsonEntry>;
}

const states = new Map<string, MemoryState>();
const migrationsDone = new Set<string>();

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function hardenPrivatePath(target: string, mode: number): void {
  if (process.platform === "win32") return;
  fs.chmodSync(target, mode);
}

function preparePrivateParent(filePath: string): void {
  const directory = path.dirname(filePath);
  const existed = fs.existsSync(directory);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  // Do not chmod an existing custom GATE_CACHE_DB parent. Gate-owned
  // .gate-mcp directories and newly created storage directories stay private.
  if (!existed || path.basename(directory) === MEMORY_DIR) {
    hardenPrivatePath(directory, 0o700);
  }
}

function hardenDatabaseFiles(dbPath: string): void {
  for (const candidate of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (fs.existsSync(candidate)) hardenPrivatePath(candidate, 0o600);
  }
}

function canonicalRoot(projectRoot: string): string {
  const candidate = path.resolve(projectRoot);
  try {
    return fs.realpathSync.native(candidate);
  } catch {
    return candidate;
  }
}

function resolveDbPath(projectRoot: string): string {
  const fromEnv = process.env.GATE_CACHE_DB;
  if (fromEnv?.trim()) {
    return safeResolve(fromEnv.trim(), { caller: "memoryDb" });
  }
  return safeResolve(path.join(projectRoot, MEMORY_DIR, "cache.db"), {
    caller: "memoryDb",
  });
}

function jsonMemoryPath(projectRoot: string): string {
  return safeResolve(path.join(projectRoot, MEMORY_DIR, MEMORY_FILE), {
    caller: "memoryDb-json",
  });
}

function createMemorySchema(db: BetterSqliteDatabase): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${MEMORY_TABLE} (
       root_key  TEXT NOT NULL,
       mem_key   TEXT NOT NULL,
       value     TEXT NOT NULL,
       updated_at INTEGER NOT NULL,
       PRIMARY KEY(root_key, mem_key)
     );
     CREATE INDEX IF NOT EXISTS idx_memory_updated_v2
       ON ${MEMORY_TABLE}(root_key, updated_at);`
  );
}

function createLegacyMemorySchema(db: BetterSqliteDatabase): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS memory_entries (
       mem_key    TEXT PRIMARY KEY,
       value      TEXT NOT NULL,
       updated_at INTEGER NOT NULL
     );
     CREATE INDEX IF NOT EXISTS idx_memory_updated
       ON memory_entries(updated_at);`
  );
}

function migrateMemorySchema(
  db: BetterSqliteDatabase,
  projectRoot: string,
  dbPath: string
): void {
  const legacyColumns = db
    .prepare("PRAGMA table_info(memory_entries)")
    .all() as Array<{ name: string }>;
  const scopedColumns = db
    .prepare(`PRAGMA table_info(${MEMORY_TABLE})`)
    .all() as Array<{ name: string }>;
  const scopedCompatible =
    scopedColumns.length === 0 ||
    (scopedColumns.some((column) => column.name === "root_key") &&
      scopedColumns.some((column) => column.name === "mem_key"));
  if (!scopedCompatible) db.exec(`DROP TABLE IF EXISTS ${MEMORY_TABLE}`);

  const releaseCandidateLayout = legacyColumns.some(
    (column) => column.name === "root_key"
  );
  if (releaseCandidateLayout) {
    createMemorySchema(db);
    db.exec(
      `INSERT OR REPLACE INTO ${MEMORY_TABLE}(root_key, mem_key, value, updated_at)
       SELECT root_key, mem_key, value, updated_at FROM memory_entries;
       DROP TABLE memory_entries;`
    );
    createLegacyMemorySchema(db);
    logger.warn(
      `memoryDb: moved release-candidate rows to ${MEMORY_TABLE} at ${dbPath}; legacy rollback table restored`
    );
    return;
  }

  const shouldImportLegacy = scopedColumns.length === 0 || !scopedCompatible;
  createMemorySchema(db);
  if (shouldImportLegacy && legacyColumns.length > 0) {
    db.prepare(
      `INSERT OR REPLACE INTO ${MEMORY_TABLE}(root_key, mem_key, value, updated_at)
       SELECT ?, mem_key, value, updated_at FROM memory_entries`
    ).run(projectRoot);
    logger.info(`memoryDb: scoped legacy SQLite rows to ${projectRoot} at ${dbPath}`);
  }
  createLegacyMemorySchema(db);
}

function openSqlite(
  projectRoot: string,
  dbPath: string
): { state?: SqlMemState; reason?: string } {
  if (process.env.GATE_FORCE_JSON_MEMORY === "1") {
    return { reason: "JSON fallback forced for storage verification" };
  }
  let Database: typeof import("better-sqlite3");
  try {
    Database = require("better-sqlite3");
  } catch (err) {
    return { reason: `better-sqlite3 unavailable: ${errorMessage(err)}` };
  }

  let db: BetterSqliteDatabase | undefined;
  try {
    preparePrivateParent(dbPath);
    db = new Database(dbPath);
    hardenDatabaseFiles(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    migrateMemorySchema(db, projectRoot, dbPath);
    hardenDatabaseFiles(dbPath);

    const stmtGet = db.prepare(
      `SELECT value FROM ${MEMORY_TABLE} WHERE root_key = ? AND mem_key = ?`
    );
    const stmtPut = db.prepare(
      `INSERT INTO ${MEMORY_TABLE}(root_key, mem_key, value, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(root_key, mem_key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`
    );
    const stmtDelete = db.prepare(
      `DELETE FROM ${MEMORY_TABLE} WHERE root_key = ? AND mem_key = ?`
    );
    const stmtClear = db.prepare(
      `DELETE FROM ${MEMORY_TABLE} WHERE root_key = ?`
    );
    const stmtCount = db.prepare(
      `SELECT COUNT(*) AS n FROM ${MEMORY_TABLE} WHERE root_key = ?`
    );
    const stmtList = db.prepare(
      `SELECT mem_key AS key, LENGTH(CAST(value AS BLOB)) AS length
       FROM ${MEMORY_TABLE} WHERE root_key = ? ORDER BY updated_at DESC`
    );
    const stmtSumBytes = db.prepare(
      `SELECT COALESCE(SUM(LENGTH(CAST(value AS BLOB))), 0) AS s
       FROM ${MEMORY_TABLE} WHERE root_key = ?`
    );
    const stmtEvictOldest = db.prepare(
      `DELETE FROM ${MEMORY_TABLE}
       WHERE root_key = ? AND mem_key IN (
         SELECT mem_key FROM ${MEMORY_TABLE} WHERE root_key = ?
         ORDER BY updated_at ASC LIMIT ?
       )`
    );

    logger.info(`memoryDb: SQLite memory opened at ${dbPath} for ${projectRoot}`);
    return {
      state: {
        kind: "sqlite",
        root: projectRoot,
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
      },
    };
  } catch (err) {
    try {
      db?.close();
    } catch {
      // Preserve the primary initialization error.
    }
    return { reason: `SQLite open failed at ${dbPath}: ${errorMessage(err)}` };
  }
}

function ensureState(projectRoot: string): MemoryState {
  const root = canonicalRoot(projectRoot);
  const existing = states.get(root);
  if (existing) {
    maybeMigrateJsonToSqlite(existing);
    return existing;
  }

  let dbPath: string;
  let invalidReason: string | undefined;
  try {
    dbPath = resolveDbPath(root);
  } catch (err) {
    dbPath = path.join(root, MEMORY_DIR, "cache.db");
    invalidReason = `invalid cache path: ${errorMessage(err)}`;
  }
  const opened = invalidReason ? {} : openSqlite(root, dbPath);
  const state: MemoryState = opened.state ?? {
    kind: "json",
    root,
    path: jsonMemoryPath(root),
    fallbackReason:
      invalidReason ?? opened.reason ?? "unknown SQLite initialization failure",
  };
  if (state.kind === "json") {
    preparePrivateParent(state.path);
    if (fs.existsSync(state.path)) hardenPrivatePath(state.path, 0o600);
  }
  states.set(root, state);
  if (state.kind === "json") {
    logger.warn(
      `memoryDb: ${state.fallbackReason}; using atomic ${MEMORY_DIR}/${MEMORY_FILE}`
    );
  }
  maybeMigrateJsonToSqlite(state);
  return state;
}

function emptyPayload(): JsonPayload {
  return { version: JSON_FORMAT_VERSION, entries: {} };
}

function loadJsonPayload(jsonPath: string): JsonPayload {
  if (!fs.existsSync(jsonPath)) return emptyPayload();
  hardenPrivatePath(jsonPath, 0o600);
  try {
    const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("root must be an object");
    }
    const object = parsed as Record<string, unknown>;
    if (object.version === JSON_FORMAT_VERSION && object.entries) {
      const entries: Record<string, JsonEntry> = {};
      for (const [key, raw] of Object.entries(
        object.entries as Record<string, unknown>
      )) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
        const entry = raw as Record<string, unknown>;
        if (typeof entry.value !== "string") continue;
        entries[key] = {
          value: entry.value,
          updatedAt:
            typeof entry.updatedAt === "number" ? entry.updatedAt : Date.now(),
        };
      }
      return { version: JSON_FORMAT_VERSION, entries };
    }

    // Pre-v1 format: { "key": "value" }.
    const entries: Record<string, JsonEntry> = {};
    const now = Date.now();
    for (const [key, value] of Object.entries(object)) {
      if (typeof value === "string") entries[key] = { value, updatedAt: now };
    }
    return { version: JSON_FORMAT_VERSION, entries };
  } catch (err) {
    logger.warn(`memoryDb: failed to load ${jsonPath}: ${errorMessage(err)}`);
    return emptyPayload();
  }
}

function saveJsonPayload(jsonPath: string, payload: JsonPayload): void {
  preparePrivateParent(jsonPath);
  const tempPath = `${jsonPath}.${process.pid}.${Date.now()}.${Math.random()
    .toString(16)
    .slice(2)}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(tempPath, "wx", 0o600);
    fs.writeFileSync(descriptor, JSON.stringify(payload, null, 2), "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(tempPath, jsonPath);
    hardenPrivatePath(jsonPath, 0o600);
  } catch (err) {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Preserve the write error.
      }
    }
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // The temp may already have been atomically renamed.
    }
    throw err;
  }
}

function withJsonLock<T>(jsonPath: string, action: () => T): T {
  preparePrivateParent(jsonPath);
  const lockPath = `${jsonPath}.lock`;
  let descriptor: number | undefined;
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    try {
      descriptor = fs.openSync(lockPath, "wx", 0o600);
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err;
      try {
        const age = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (age > LOCK_STALE_MS) {
          fs.unlinkSync(lockPath);
          continue;
        }
      } catch {
        continue;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  if (descriptor === undefined) {
    throw new Error(`memoryDb: timed out acquiring lock ${lockPath}`);
  }
  try {
    return action();
  } finally {
    try {
      fs.closeSync(descriptor);
    } finally {
      try {
        fs.unlinkSync(lockPath);
      } catch (err) {
        logger.warn(`memoryDb: failed to release ${lockPath}: ${errorMessage(err)}`);
      }
    }
  }
}

function enforceLruJson(payload: JsonPayload): void {
  const rows = Object.entries(payload.entries).sort(
    ([, a], [, b]) => a.updatedAt - b.updatedAt
  );
  let bytes = rows.reduce(
    (total, [, entry]) => total + Buffer.byteLength(entry.value, "utf8"),
    0
  );
  let count = rows.length;
  for (const [key, entry] of rows) {
    if (count <= MAX_MEMORY_ENTRIES && bytes <= MAX_MEMORY_BYTES) break;
    delete payload.entries[key];
    count -= 1;
    bytes -= Buffer.byteLength(entry.value, "utf8");
  }
}

function enforceLruSqlite(state: SqlMemState): void {
  const root = state.root;
  const count = (state.stmtCount.get(root) as { n: number }).n;
  if (count > MAX_MEMORY_ENTRIES) {
    state.stmtEvictOldest.run(root, root, count - MAX_MEMORY_ENTRIES);
  }
  let bytes = Number(
    (state.stmtSumBytes.get(root) as { s: number | bigint }).s
  );
  let safety = 50;
  while (bytes > MAX_MEMORY_BYTES && safety-- > 0) {
    state.stmtEvictOldest.run(
      root,
      root,
      Math.max(1, Math.floor(MAX_MEMORY_ENTRIES / 20))
    );
    bytes = Number((state.stmtSumBytes.get(root) as { s: number | bigint }).s);
  }
}

function maybeMigrateJsonToSqlite(state: MemoryState): void {
  if (state.kind !== "sqlite" || migrationsDone.has(state.root)) return;
  migrationsDone.add(state.root);
  const jsonPath = jsonMemoryPath(state.root);
  if (!fs.existsSync(jsonPath)) return;
  if ((state.stmtCount.get(state.root) as { n: number }).n > 0) return;

  const payload = loadJsonPayload(jsonPath);
  const rows = Object.entries(payload.entries);
  if (rows.length === 0) return;
  for (const [key, entry] of rows) {
    state.stmtPut.run(state.root, key, entry.value, entry.updatedAt);
  }
  enforceLruSqlite(state);
  const migratedPath = path.join(path.dirname(jsonPath), MEMORY_MIGRATED);
  try {
    fs.renameSync(jsonPath, migratedPath);
    hardenPrivatePath(migratedPath, 0o600);
    logger.info(`memoryDb: migrated ${rows.length} JSON entries to SQLite`);
  } catch (err) {
    logger.warn(`memoryDb: migrated rows but could not rename JSON: ${errorMessage(err)}`);
  }
}

export function isMemoryPersistent(projectRoot?: string): boolean {
  return ensureState(projectRoot ?? process.cwd()).kind === "sqlite";
}

export function memoryBackendLabel(projectRoot?: string): string {
  const state = ensureState(projectRoot ?? process.cwd());
  return state.kind === "sqlite"
    ? `SQLite (${state.path}; root=${state.root})`
    : `JSON (${state.path}; root=${state.root}; ${state.fallbackReason})`;
}

export function memoryGet(projectRoot: string, key: string): string | undefined {
  const state = ensureState(projectRoot);
  if (state.kind === "sqlite") {
    const row = state.stmtGet.get(state.root, key) as
      | { value: string }
      | undefined;
    return row?.value;
  }
  return loadJsonPayload(state.path).entries[key]?.value;
}

export function memoryPut(
  projectRoot: string,
  key: string,
  value: string
): number {
  if (Buffer.byteLength(value, "utf8") > MAX_MEMORY_BYTES) {
    throw new Error(`memoryDb: value exceeds ${MAX_MEMORY_BYTES} byte limit`);
  }
  const state = ensureState(projectRoot);
  if (state.kind === "sqlite") {
    state.stmtPut.run(state.root, key, value, Date.now());
    enforceLruSqlite(state);
    return (state.stmtCount.get(state.root) as { n: number }).n;
  }
  return withJsonLock(state.path, () => {
    const payload = loadJsonPayload(state.path);
    payload.entries[key] = { value, updatedAt: Date.now() };
    enforceLruJson(payload);
    saveJsonPayload(state.path, payload);
    return Object.keys(payload.entries).length;
  });
}

export function memoryDelete(
  projectRoot: string,
  key: string
): { deleted: boolean; count: number } {
  const state = ensureState(projectRoot);
  if (state.kind === "sqlite") {
    const result = state.stmtDelete.run(state.root, key);
    return {
      deleted: result.changes > 0,
      count: (state.stmtCount.get(state.root) as { n: number }).n,
    };
  }
  return withJsonLock(state.path, () => {
    const payload = loadJsonPayload(state.path);
    const deleted = key in payload.entries;
    delete payload.entries[key];
    saveJsonPayload(state.path, payload);
    return { deleted, count: Object.keys(payload.entries).length };
  });
}

export function memoryClear(projectRoot: string): number {
  const state = ensureState(projectRoot);
  if (state.kind === "sqlite") {
    const before = (state.stmtCount.get(state.root) as { n: number }).n;
    state.stmtClear.run(state.root);
    return before;
  }
  return withJsonLock(state.path, () => {
    const payload = loadJsonPayload(state.path);
    const before = Object.keys(payload.entries).length;
    saveJsonPayload(state.path, emptyPayload());
    return before;
  });
}

export function memoryCount(projectRoot: string): number {
  const state = ensureState(projectRoot);
  if (state.kind === "sqlite") {
    return (state.stmtCount.get(state.root) as { n: number }).n;
  }
  return Object.keys(loadJsonPayload(state.path).entries).length;
}

export function memoryList(
  projectRoot: string
): Array<{ key: string; length: number }> {
  const state = ensureState(projectRoot);
  if (state.kind === "sqlite") {
    return state.stmtList.all(state.root) as Array<{
      key: string;
      length: number;
    }>;
  }
  const payload = loadJsonPayload(state.path);
  return Object.entries(payload.entries)
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
    .map(([key, entry]) => ({
      key,
      length: Buffer.byteLength(entry.value, "utf8"),
    }));
}

function closeState(state: MemoryState): void {
  if (state.kind !== "sqlite") return;
  try {
    state.db.close();
  } catch (err) {
    logger.warn(`memoryDb: close failed at ${state.path}: ${errorMessage(err)}`);
  }
}

export function closeAllMemoryDbs(): void {
  for (const state of states.values()) closeState(state);
  states.clear();
  migrationsDone.clear();
}

/** Reset all project-keyed module state (tests only). */
export function _resetMemoryDbForTests(): void {
  closeAllMemoryDbs();
}
