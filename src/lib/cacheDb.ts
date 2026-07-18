/** Persistent, project-isolated dedup cache with an optional SQLite backend. */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { Database as BetterSqliteDatabase, Statement } from "better-sqlite3";
import { safeResolve } from "./pathGuard.js";
import logger from "./logger.js";

const require = createRequire(import.meta.url);

export const MAX_ENTRIES = 10_000;
export const MAX_BYTES = 500 * 1024 * 1024;
export const COMPRESSOR_CACHE_VERSION = "gate-compressor-v1";
export const CACHE_SCHEMA_VERSION = 3;
const CACHE_TABLE = "cache_entries_v3";
const CACHE_SCHEMA_META_KEY = "schema_version_v3";

const LEGACY_DEPTH = "legacy";
const UNKNOWN_LANGUAGE = "unknown";

export type CacheType = "file" | "image";

export interface CacheIdentity {
  hash: string;
  depth: string;
  language: string;
  compressorVersion?: string;
  schemaVersion?: number;
}

export interface CacheEntryRow {
  cacheKey: string;
  filePath: string;
  hash: string;
  depth: string;
  language: string;
  compressorVersion: string;
  schemaVersion: number;
  content: string;
  tokens: number;
  originalTokens: number;
  type: CacheType;
  hitCount: number;
  updatedAt: number;
}

export interface CacheEntryInput {
  filePath: string;
  hash: string;
  depth?: string;
  language?: string;
  compressorVersion?: string;
  schemaVersion?: number;
  content: string;
  tokens: number;
  originalTokens: number;
  type: CacheType;
}

export interface CacheStatsRow {
  filePath: string;
  hitCount: number;
  tokensSaved: number;
  lastAccess: string;
}

export interface CacheStats {
  totalEntries: number;
  totalHits: number;
  totalTokensSaved: number;
  entries: CacheStatsRow[];
}

export interface CacheBackendInfo {
  kind: "sqlite" | "memory";
  path: string;
  persistent: boolean;
  fallbackReason?: string;
}

type SqlState = {
  kind: "sqlite";
  root: string;
  db: BetterSqliteDatabase;
  path: string;
  stmtGet: Statement;
  stmtGetLatest: Statement;
  stmtPut: Statement;
  stmtHit: Statement;
  stmtHitLatest: Statement;
  stmtDelete: Statement;
  stmtDeletePath: Statement;
  stmtClear: Statement;
  stmtCount: Statement;
  stmtSumHits: Statement;
  stmtSumSavings: Statement;
  stmtSumBytes: Statement;
  stmtList: Statement;
  stmtEvictOldest: Statement;
};

type MemState = {
  kind: "memory";
  root: string;
  path: string;
  fallbackReason: string;
  map: Map<string, CacheEntryRow>;
};

type CacheState = SqlState | MemState;

const states = new Map<string, CacheState>();

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function hardenPrivatePath(target: string, mode: number): void {
  if (process.platform === "win32") return;
  fs.chmodSync(target, mode);
}

function prepareDatabaseDirectory(dbPath: string): void {
  const directory = path.dirname(dbPath);
  const existed = fs.existsSync(directory);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  // Avoid changing an existing custom GATE_CACHE_DB parent such as the
  // workspace root. Default .gate-mcp directories are always private.
  if (!existed || path.basename(directory) === ".gate-mcp") {
    hardenPrivatePath(directory, 0o700);
  }
}

function hardenDatabaseFiles(dbPath: string): void {
  for (const candidate of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (fs.existsSync(candidate)) hardenPrivatePath(candidate, 0o600);
  }
}

function canonicalDirectory(projectRoot?: string): string {
  const candidate = path.resolve(
    projectRoot ?? process.env.GATE_PROJECT_ROOT ?? process.cwd()
  );
  try {
    return fs.realpathSync.native(candidate);
  } catch {
    return candidate;
  }
}

function canonicalFile(filePath: string): string {
  const candidate = path.resolve(filePath);
  try {
    return fs.realpathSync.native(candidate);
  } catch {
    return candidate;
  }
}

function resolveDbPath(projectRoot: string): string {
  const fromEnv = process.env.GATE_CACHE_DB;
  if (fromEnv?.trim()) {
    return safeResolve(fromEnv.trim(), { caller: "cacheDb" });
  }
  return safeResolve(path.join(projectRoot, ".gate-mcp", "cache.db"), {
    caller: "cacheDb",
  });
}

function normalizeIdentity(identity: CacheIdentity): Required<CacheIdentity> {
  return {
    hash: identity.hash,
    depth: identity.depth || LEGACY_DEPTH,
    language: identity.language || UNKNOWN_LANGUAGE,
    compressorVersion:
      identity.compressorVersion || COMPRESSOR_CACHE_VERSION,
    schemaVersion: identity.schemaVersion ?? CACHE_SCHEMA_VERSION,
  };
}

/** Stable identity: canonical path + content + view + implementation schema. */
export function cacheIdentityKey(
  filePath: string,
  identity: CacheIdentity
): string {
  const normalized = normalizeIdentity(identity);
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify([
        canonicalFile(filePath),
        normalized.hash,
        normalized.depth,
        normalized.language,
        normalized.compressorVersion,
        normalized.schemaVersion,
      ])
    )
    .digest("hex");
}

function createSchema(db: BetterSqliteDatabase): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${CACHE_TABLE} (
       cache_key          TEXT NOT NULL,
       root_key           TEXT NOT NULL,
       file_path          TEXT NOT NULL,
       hash               TEXT NOT NULL,
       depth              TEXT NOT NULL,
       language           TEXT NOT NULL,
       compressor_version TEXT NOT NULL,
       schema_version     INTEGER NOT NULL,
       content            TEXT NOT NULL,
       tokens             INTEGER NOT NULL,
       original_tokens    INTEGER NOT NULL,
       type               TEXT NOT NULL DEFAULT 'file',
       hit_count          INTEGER NOT NULL DEFAULT 0,
       updated_at         INTEGER NOT NULL,
       PRIMARY KEY(root_key, cache_key)
     );
     CREATE INDEX IF NOT EXISTS idx_cache_file_v3
       ON ${CACHE_TABLE}(root_key, file_path);
     CREATE INDEX IF NOT EXISTS idx_updated_v3
       ON ${CACHE_TABLE}(root_key, updated_at);
     CREATE TABLE IF NOT EXISTS cache_meta (
       key TEXT PRIMARY KEY,
       value TEXT NOT NULL
     );`
  );
}

/**
 * Early v0.5.6 release candidates reused `cache_entries` for the v3 layout.
 * Move that data once, then restore the legacy table shape so v0.5.5 remains
 * able to open the same database during rollback.
 */
function migrateReleaseCandidateTable(
  db: BetterSqliteDatabase,
  dbPath: string
): void {
  const legacyColumns = db
    .prepare("PRAGMA table_info(cache_entries)")
    .all() as Array<{ name: string }>;
  if (!legacyColumns.some((column) => column.name === "cache_key")) return;

  const targetColumns = db
    .prepare(`PRAGMA table_info(${CACHE_TABLE})`)
    .all() as Array<{ name: string }>;
  const targetCompatible =
    targetColumns.length === 0 ||
    (targetColumns.some((column) => column.name === "cache_key") &&
      targetColumns.some((column) => column.name === "root_key") &&
      targetColumns.some((column) => column.name === "compressor_version"));
  if (!targetCompatible) db.exec(`DROP TABLE IF EXISTS ${CACHE_TABLE}`);

  createSchema(db);
  db.exec(
    `INSERT OR REPLACE INTO ${CACHE_TABLE}
       (cache_key, root_key, file_path, hash, depth, language,
        compressor_version, schema_version, content, tokens, original_tokens,
        type, hit_count, updated_at)
     SELECT cache_key, root_key, file_path, hash, depth, language,
            compressor_version, schema_version, content, tokens,
            original_tokens, type, hit_count, updated_at
       FROM cache_entries;
     DROP TABLE cache_entries;
     CREATE TABLE cache_entries (
       file_path       TEXT PRIMARY KEY,
       hash            TEXT NOT NULL,
       content         TEXT NOT NULL,
       tokens          INTEGER NOT NULL,
       original_tokens INTEGER NOT NULL,
       type            TEXT NOT NULL DEFAULT 'file',
       hit_count       INTEGER NOT NULL DEFAULT 0,
       updated_at      INTEGER NOT NULL
     );
     CREATE INDEX IF NOT EXISTS idx_updated ON cache_entries(updated_at);`
  );
  db.prepare(
    `INSERT INTO cache_meta(key, value) VALUES(?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run("schema_version", "1");
  db.prepare(
    `INSERT INTO cache_meta(key, value) VALUES(?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(CACHE_SCHEMA_META_KEY, String(CACHE_SCHEMA_VERSION));
  logger.warn(
    `cacheDb: moved release-candidate v3 rows to ${CACHE_TABLE} at ${dbPath}; legacy rollback table restored`
  );
}

function migrateSchema(db: BetterSqliteDatabase, dbPath: string): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS cache_meta (
       key TEXT PRIMARY KEY,
     value TEXT NOT NULL
     );`
  );
  migrateReleaseCandidateTable(db, dbPath);
  const columns = db
    .prepare(`PRAGMA table_info(${CACHE_TABLE})`)
    .all() as Array<{ name: string }>;
  const stored = db
    .prepare("SELECT value FROM cache_meta WHERE key = ?")
    .get(CACHE_SCHEMA_META_KEY) as { value: string } | undefined;
  const compatible =
    columns.length === 0 ||
    (stored?.value === String(CACHE_SCHEMA_VERSION) &&
      columns.some((column) => column.name === "cache_key") &&
      columns.some((column) => column.name === "root_key") &&
      columns.some((column) => column.name === "depth") &&
      columns.some((column) => column.name === "compressor_version"));

  if (!compatible) {
    db.exec(`DROP TABLE IF EXISTS ${CACHE_TABLE}`);
    logger.warn(
      `cacheDb: invalidated legacy cache rows at ${dbPath} for schema v${CACHE_SCHEMA_VERSION}`
    );
  }
  createSchema(db);
  db.prepare(
    `INSERT INTO cache_meta(key, value) VALUES('${CACHE_SCHEMA_META_KEY}', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(String(CACHE_SCHEMA_VERSION));
}

function openSqlite(
  projectRoot: string,
  dbPath: string
): { state?: SqlState; reason?: string } {
  let Database: typeof import("better-sqlite3");
  try {
    Database = require("better-sqlite3");
  } catch (err) {
    return { reason: `better-sqlite3 unavailable: ${errorMessage(err)}` };
  }

  let db: BetterSqliteDatabase | undefined;
  try {
    prepareDatabaseDirectory(dbPath);
    db = new Database(dbPath);
    hardenDatabaseFiles(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    migrateSchema(db, dbPath);
    hardenDatabaseFiles(dbPath);

    const stmtGet = db.prepare(
      `SELECT cache_key AS cacheKey, file_path AS filePath, hash, depth,
              language, compressor_version AS compressorVersion,
              schema_version AS schemaVersion, content, tokens,
              original_tokens AS originalTokens, type,
              hit_count AS hitCount, updated_at AS updatedAt
         FROM ${CACHE_TABLE} WHERE root_key = ? AND cache_key = ?`
    );
    const stmtGetLatest = db.prepare(
      `SELECT cache_key AS cacheKey, file_path AS filePath, hash, depth,
              language, compressor_version AS compressorVersion,
              schema_version AS schemaVersion, content, tokens,
              original_tokens AS originalTokens, type,
              hit_count AS hitCount, updated_at AS updatedAt
         FROM ${CACHE_TABLE} WHERE root_key = ? AND file_path = ?
         ORDER BY updated_at DESC LIMIT 1`
    );
    const stmtPut = db.prepare(
      `INSERT INTO ${CACHE_TABLE}
         (cache_key, root_key, file_path, hash, depth, language, compressor_version,
          schema_version, content, tokens, original_tokens, type, hit_count,
          updated_at)
       VALUES (@cacheKey, @rootKey, @filePath, @hash, @depth, @language,
               @compressorVersion, @schemaVersion, @content, @tokens,
               @originalTokens, @type, 0, @updatedAt)
       ON CONFLICT(root_key, cache_key) DO UPDATE SET
         content = excluded.content,
         tokens = excluded.tokens,
         original_tokens = excluded.original_tokens,
         type = excluded.type,
         hit_count = 0,
         updated_at = excluded.updated_at`
    );
    const stmtHit = db.prepare(
      `UPDATE ${CACHE_TABLE} SET hit_count = hit_count + 1, updated_at = ?
       WHERE root_key = ? AND cache_key = ?`
    );
    const stmtHitLatest = db.prepare(
      `UPDATE ${CACHE_TABLE} SET hit_count = hit_count + 1, updated_at = ?
       WHERE root_key = ? AND cache_key = (
         SELECT cache_key FROM ${CACHE_TABLE}
         WHERE root_key = ? AND file_path = ?
         ORDER BY updated_at DESC LIMIT 1
       )`
    );
    const stmtDelete = db.prepare(
      `DELETE FROM ${CACHE_TABLE} WHERE root_key = ? AND cache_key = ?`
    );
    const stmtDeletePath = db.prepare(
      `DELETE FROM ${CACHE_TABLE} WHERE root_key = ? AND file_path = ?`
    );
    const stmtClear = db.prepare(`DELETE FROM ${CACHE_TABLE} WHERE root_key = ?`);
    const stmtCount = db.prepare(
      `SELECT COUNT(*) AS n FROM ${CACHE_TABLE} WHERE root_key = ?`
    );
    const stmtSumHits = db.prepare(
      `SELECT COALESCE(SUM(hit_count), 0) AS s FROM ${CACHE_TABLE}
       WHERE root_key = ?`
    );
    const stmtSumSavings = db.prepare(
      `SELECT COALESCE(SUM(hit_count * MAX(0, original_tokens - tokens)), 0) AS s
       FROM ${CACHE_TABLE} WHERE root_key = ?`
    );
    const stmtSumBytes = db.prepare(
      `SELECT COALESCE(SUM(LENGTH(CAST(content AS BLOB))), 0) AS s
       FROM ${CACHE_TABLE} WHERE root_key = ?`
    );
    const stmtList = db.prepare(
      `SELECT file_path AS filePath, hit_count AS hitCount,
              (hit_count * MAX(0, original_tokens - tokens)) AS tokensSaved,
              updated_at AS updatedAt
       FROM ${CACHE_TABLE} WHERE root_key = ? ORDER BY updated_at DESC`
    );
    const stmtEvictOldest = db.prepare(
      `DELETE FROM ${CACHE_TABLE} WHERE root_key = ? AND cache_key IN (
         SELECT cache_key FROM ${CACHE_TABLE} WHERE root_key = ?
         ORDER BY updated_at ASC LIMIT ?
       )`
    );

    logger.info(`cacheDb: persistent SQLite cache opened at ${dbPath}`);
    return {
      state: {
        kind: "sqlite",
        root: projectRoot,
        db,
        path: dbPath,
        stmtGet,
        stmtGetLatest,
        stmtPut,
        stmtHit,
        stmtHitLatest,
        stmtDelete,
        stmtDeletePath,
        stmtClear,
        stmtCount,
        stmtSumHits,
        stmtSumSavings,
        stmtSumBytes,
        stmtList,
        stmtEvictOldest,
      },
    };
  } catch (err) {
    try {
      db?.close();
    } catch {
      // Preserve the primary open/migration failure.
    }
    return { reason: `SQLite open failed at ${dbPath}: ${errorMessage(err)}` };
  }
}

function ensureState(projectRoot?: string): CacheState {
  const root = canonicalDirectory(projectRoot);
  const existing = states.get(root);
  if (existing) return existing;

  let dbPath: string;
  try {
    dbPath = resolveDbPath(root);
  } catch (err) {
    dbPath = path.join(root, ".gate-mcp", "cache.db");
    const fallback: MemState = {
      kind: "memory",
      root,
      path: dbPath,
      fallbackReason: `invalid cache path: ${errorMessage(err)}`,
      map: new Map(),
    };
    states.set(root, fallback);
    logger.warn(`cacheDb: ${fallback.fallbackReason}; using memory`);
    return fallback;
  }

  const opened = openSqlite(root, dbPath);
  if (opened.state) {
    states.set(root, opened.state);
    return opened.state;
  }
  const fallback: MemState = {
    kind: "memory",
    root,
    path: dbPath,
    fallbackReason: opened.reason ?? "unknown SQLite initialization failure",
    map: new Map(),
  };
  states.set(root, fallback);
  logger.warn(`cacheDb: ${fallback.fallbackReason}; using in-memory cache`);
  return fallback;
}

function rowFromInput(input: CacheEntryInput): CacheEntryRow {
  const filePath = canonicalFile(input.filePath);
  const identity = normalizeIdentity({
    hash: input.hash,
    depth: input.depth ?? LEGACY_DEPTH,
    language: input.language ?? UNKNOWN_LANGUAGE,
    compressorVersion: input.compressorVersion,
    schemaVersion: input.schemaVersion,
  });
  return {
    cacheKey: cacheIdentityKey(filePath, identity),
    filePath,
    ...identity,
    content: input.content,
    tokens: input.tokens,
    originalTokens: input.originalTokens,
    type: input.type,
    hitCount: 0,
    updatedAt: Date.now(),
  };
}

function latestMemoryEntry(
  state: MemState,
  filePath: string
): CacheEntryRow | null {
  let latest: CacheEntryRow | null = null;
  for (const row of state.map.values()) {
    if (row.filePath !== filePath) continue;
    if (!latest || row.updatedAt > latest.updatedAt) latest = row;
  }
  return latest;
}

export function cacheBackendInfo(projectRoot?: string): CacheBackendInfo {
  const state = ensureState(projectRoot);
  return state.kind === "sqlite"
    ? { kind: "sqlite", path: state.path, persistent: true }
    : {
        kind: "memory",
        path: state.path,
        persistent: false,
        fallbackReason: state.fallbackReason,
      };
}

export function isPersistent(projectRoot?: string): boolean {
  return ensureState(projectRoot).kind === "sqlite";
}

export function cacheDbPath(projectRoot?: string): string {
  return ensureState(projectRoot).path;
}

export function getEntry(
  filePath: string,
  identity?: CacheIdentity,
  projectRoot?: string
): CacheEntryRow | null {
  const state = ensureState(projectRoot);
  const canonicalPath = canonicalFile(filePath);
  if (state.kind === "sqlite") {
    const row = identity
      ? state.stmtGet.get(
          state.root,
          cacheIdentityKey(canonicalPath, identity)
        )
      : state.stmtGetLatest.get(state.root, canonicalPath);
    return (row as CacheEntryRow | undefined) ?? null;
  }
  if (identity) {
    return state.map.get(cacheIdentityKey(canonicalPath, identity)) ?? null;
  }
  return latestMemoryEntry(state, canonicalPath);
}

export function putEntry(
  input: CacheEntryInput,
  projectRoot?: string
): CacheEntryRow {
  const state = ensureState(projectRoot);
  const row = rowFromInput(input);
  if (state.kind === "sqlite") {
    state.stmtPut.run({
      cacheKey: row.cacheKey,
      rootKey: state.root,
      filePath: row.filePath,
      hash: row.hash,
      depth: row.depth,
      language: row.language,
      compressorVersion: row.compressorVersion,
      schemaVersion: row.schemaVersion,
      content: row.content,
      tokens: row.tokens,
      originalTokens: row.originalTokens,
      type: row.type,
      updatedAt: row.updatedAt,
    });
    enforceLruSqlite(state);
  } else {
    state.map.set(row.cacheKey, row);
    enforceLruMemory(state);
  }
  return row;
}

export function recordHit(
  filePath: string,
  identity?: CacheIdentity,
  projectRoot?: string
): CacheEntryRow | null {
  const state = ensureState(projectRoot);
  const canonicalPath = canonicalFile(filePath);
  const now = Date.now();
  if (state.kind === "sqlite") {
    const result = identity
      ? state.stmtHit.run(
          now,
          state.root,
          cacheIdentityKey(canonicalPath, identity)
        )
      : state.stmtHitLatest.run(now, state.root, state.root, canonicalPath);
    if (result.changes === 0) return null;
    return getEntry(canonicalPath, identity, projectRoot);
  }
  const row = identity
    ? state.map.get(cacheIdentityKey(canonicalPath, identity))
    : latestMemoryEntry(state, canonicalPath);
  if (!row) return null;
  row.hitCount += 1;
  row.updatedAt = now;
  return row;
}

export function deleteEntry(
  filePath: string,
  identity?: CacheIdentity,
  projectRoot?: string
): boolean {
  const state = ensureState(projectRoot);
  const canonicalPath = canonicalFile(filePath);
  if (state.kind === "sqlite") {
    const result = identity
      ? state.stmtDelete.run(
          state.root,
          cacheIdentityKey(canonicalPath, identity)
        )
      : state.stmtDeletePath.run(state.root, canonicalPath);
    return result.changes > 0;
  }
  if (identity) {
    return state.map.delete(cacheIdentityKey(canonicalPath, identity));
  }
  let deleted = false;
  for (const [key, row] of state.map) {
    if (row.filePath === canonicalPath) {
      state.map.delete(key);
      deleted = true;
    }
  }
  return deleted;
}

export function clearAll(projectRoot?: string): number {
  const state = ensureState(projectRoot);
  if (state.kind === "sqlite") {
    const before = (state.stmtCount.get(state.root) as { n: number }).n;
    state.stmtClear.run(state.root);
    return before;
  }
  const before = state.map.size;
  state.map.clear();
  return before;
}

export function getStats(projectRoot?: string): CacheStats {
  const state = ensureState(projectRoot);
  if (state.kind === "sqlite") {
    const rows = state.stmtList.all(state.root) as Array<{
      filePath: string;
      hitCount: number;
      tokensSaved: number;
      updatedAt: number;
    }>;
    return {
      totalEntries: (state.stmtCount.get(state.root) as { n: number }).n,
      totalHits: Number(
        (state.stmtSumHits.get(state.root) as { s: number | bigint }).s
      ),
      totalTokensSaved: Number(
        (state.stmtSumSavings.get(state.root) as { s: number | bigint }).s
      ),
      entries: rows.map((row) => ({
        filePath: row.filePath,
        hitCount: row.hitCount,
        tokensSaved: row.tokensSaved,
        lastAccess: new Date(row.updatedAt).toISOString(),
      })),
    };
  }
  const entries: CacheStatsRow[] = [];
  let totalHits = 0;
  let totalTokensSaved = 0;
  for (const row of state.map.values()) {
    const saved = row.hitCount * Math.max(0, row.originalTokens - row.tokens);
    totalHits += row.hitCount;
    totalTokensSaved += saved;
    entries.push({
      filePath: row.filePath,
      hitCount: row.hitCount,
      tokensSaved: saved,
      lastAccess: new Date(row.updatedAt).toISOString(),
    });
  }
  entries.sort((a, b) => b.lastAccess.localeCompare(a.lastAccess));
  return { totalEntries: state.map.size, totalHits, totalTokensSaved, entries };
}

function enforceLruSqlite(state: SqlState): void {
  const count = (state.stmtCount.get(state.root) as { n: number }).n;
  if (count > MAX_ENTRIES) {
    state.stmtEvictOldest.run(
      state.root,
      state.root,
      count - MAX_ENTRIES
    );
  }
  let bytes = Number(
    (state.stmtSumBytes.get(state.root) as { s: number | bigint }).s
  );
  let safety = 100;
  while (bytes > MAX_BYTES && safety-- > 0) {
    state.stmtEvictOldest.run(
      state.root,
      state.root,
      Math.max(1, Math.floor(MAX_ENTRIES / 50))
    );
    bytes = Number(
      (state.stmtSumBytes.get(state.root) as { s: number | bigint }).s
    );
  }
}

function enforceLruMemory(state: MemState): void {
  let bytes = 0;
  for (const row of state.map.values()) {
    bytes += Buffer.byteLength(row.content, "utf8");
  }
  if (state.map.size <= MAX_ENTRIES && bytes <= MAX_BYTES) return;
  const rows = [...state.map.values()].sort((a, b) => a.updatedAt - b.updatedAt);
  for (const row of rows) {
    if (state.map.size <= MAX_ENTRIES && bytes <= MAX_BYTES) break;
    bytes -= Buffer.byteLength(row.content, "utf8");
    state.map.delete(row.cacheKey);
  }
}

function closeState(state: CacheState): void {
  if (state.kind !== "sqlite") return;
  try {
    state.db.close();
    logger.info(`cacheDb: SQLite cache closed at ${state.path}`);
  } catch (err) {
    logger.warn(`cacheDb: close failed at ${state.path}: ${errorMessage(err)}`);
  }
}

/** Close one project state, or every state when projectRoot is omitted. */
export function closeCacheDb(projectRoot?: string): void {
  if (projectRoot !== undefined) {
    const root = canonicalDirectory(projectRoot);
    const state = states.get(root);
    if (state) closeState(state);
    states.delete(root);
    return;
  }
  closeAllCacheDbs();
}

export function closeAllCacheDbs(): void {
  for (const state of states.values()) closeState(state);
  states.clear();
}
