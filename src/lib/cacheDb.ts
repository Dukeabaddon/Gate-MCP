/**
 * Persistent Cache Database for Gate-MCP (v0.4.0).
 *
 * Backs the gate_dedup_context session cache with SQLite (via better-sqlite3)
 * so cache entries survive across IDE sessions and across concurrent IDEs.
 *
 * Design (FAIROS):
 *   - better-sqlite3 is an OPTIONAL dependency. If it fails to load (native
 *     compile failure, prebuilt binary missing for this platform, etc.), the
 *     cache transparently degrades to an in-memory Map with identical
 *     semantics. The MCP server never crashes because of cache issues.
 *   - WAL journal mode + NORMAL synchronous: safe for concurrent IDE access
 *     without sacrificing write throughput.
 *   - All public functions return plain typed rows — the raw Database object
 *     never leaves this module.
 *   - LRU eviction by `updated_at`: cap at MAX_ENTRIES rows OR MAX_BYTES
 *     content size, whichever is hit first.
 *
 * Path resolution for the database file:
 *   1. process.env.GATE_CACHE_DB if set
 *   2. otherwise <projectRoot>/.gate-mcp/cache.db
 *
 *   The path is validated via safeResolve so a malicious env var cannot
 *   point us at /etc/passwd. Boundary rules from pathGuard apply.
 */

import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import type { Database as BetterSqliteDatabase, Statement } from "better-sqlite3";
import { safeResolve } from "./pathGuard.js";
import logger from "./logger.js";

const require = createRequire(import.meta.url);

// ─── Tunables ───────────────────────────────────────────────────────────────

/** Max number of rows kept in the cache before LRU eviction kicks in. */
export const MAX_ENTRIES = 10_000;
/** Max combined byte length of `content` columns (~character count for UTF-8). */
export const MAX_BYTES = 500 * 1024 * 1024;
/** Schema version for future migrations. */
const SCHEMA_VERSION = 1;

// ─── Types ──────────────────────────────────────────────────────────────────

export type CacheType = "file" | "image";

export interface CacheEntryRow {
  filePath: string;
  hash: string;
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

// ─── State ──────────────────────────────────────────────────────────────────

type SqlState = {
  kind: "sqlite";
  db: BetterSqliteDatabase;
  path: string;
  stmtGet: Statement;
  stmtPut: Statement;
  stmtHit: Statement;
  stmtDelete: Statement;
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
  map: Map<string, CacheEntryRow>;
};

let state: SqlState | MemState | null = null;

// ─── Initialization ─────────────────────────────────────────────────────────

function resolveDbPath(): string {
  const fromEnv = process.env.GATE_CACHE_DB;
  if (fromEnv && fromEnv.trim().length > 0) {
    return safeResolve(fromEnv, { caller: "cacheDb" });
  }
  const root = process.env.GATE_PROJECT_ROOT ?? process.cwd();
  const file = path.join(root, ".gate-mcp", "cache.db");
  return safeResolve(file, { caller: "cacheDb" });
}

function tryOpenSqlite(): SqlState | null {
  let Database: typeof import("better-sqlite3");
  try {
    Database = require("better-sqlite3");
  } catch (err) {
    logger.warn(
      `cacheDb: better-sqlite3 unavailable, falling back to in-memory Map cache: ${
        err instanceof Error ? err.message : err
      }`
    );
    return null;
  }

  let dbPath: string;
  try {
    dbPath = resolveDbPath();
  } catch (err) {
    logger.warn(
      `cacheDb: refusing to open invalid cache path (using in-memory fallback): ${
        err instanceof Error ? err.message : err
      }`
    );
    return null;
  }

  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.exec(
      `CREATE TABLE IF NOT EXISTS cache_entries (
         file_path        TEXT PRIMARY KEY,
         hash             TEXT NOT NULL,
         content          TEXT NOT NULL,
         tokens           INTEGER NOT NULL,
         original_tokens  INTEGER NOT NULL,
         type             TEXT NOT NULL DEFAULT 'file',
         hit_count        INTEGER NOT NULL DEFAULT 0,
         updated_at       INTEGER NOT NULL
       );
       CREATE INDEX IF NOT EXISTS idx_updated ON cache_entries(updated_at);
       CREATE TABLE IF NOT EXISTS cache_meta (
         key TEXT PRIMARY KEY,
         value TEXT NOT NULL
       );`
    );
    db.prepare(
      `INSERT INTO cache_meta(key, value) VALUES('schema_version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(String(SCHEMA_VERSION));

    const stmtGet = db.prepare(
      `SELECT file_path AS filePath, hash, content, tokens,
              original_tokens AS originalTokens, type,
              hit_count AS hitCount, updated_at AS updatedAt
         FROM cache_entries
         WHERE file_path = ?`
    );
    const stmtPut = db.prepare(
      `INSERT INTO cache_entries
         (file_path, hash, content, tokens, original_tokens, type, hit_count, updated_at)
       VALUES (@filePath, @hash, @content, @tokens, @originalTokens, @type, 0, @updatedAt)
       ON CONFLICT(file_path) DO UPDATE SET
         hash = excluded.hash,
         content = excluded.content,
         tokens = excluded.tokens,
         original_tokens = excluded.original_tokens,
         type = excluded.type,
         hit_count = 0,
         updated_at = excluded.updated_at`
    );
    const stmtHit = db.prepare(
      `UPDATE cache_entries
         SET hit_count = hit_count + 1, updated_at = ?
         WHERE file_path = ?`
    );
    const stmtDelete = db.prepare(`DELETE FROM cache_entries WHERE file_path = ?`);
    const stmtClear = db.prepare(`DELETE FROM cache_entries`);
    const stmtCount = db.prepare(`SELECT COUNT(*) AS n FROM cache_entries`);
    const stmtSumHits = db.prepare(
      `SELECT COALESCE(SUM(hit_count), 0) AS s FROM cache_entries`
    );
    const stmtSumSavings = db.prepare(
      `SELECT COALESCE(SUM(hit_count * MAX(0, original_tokens - tokens)), 0) AS s
         FROM cache_entries`
    );
    const stmtSumBytes = db.prepare(
      `SELECT COALESCE(SUM(LENGTH(content)), 0) AS s FROM cache_entries`
    );
    const stmtList = db.prepare(
      `SELECT file_path AS filePath,
              hit_count AS hitCount,
              (hit_count * MAX(0, original_tokens - tokens)) AS tokensSaved,
              updated_at AS updatedAt
         FROM cache_entries
         ORDER BY updated_at DESC`
    );
    const stmtEvictOldest = db.prepare(
      `DELETE FROM cache_entries
         WHERE file_path IN (
           SELECT file_path FROM cache_entries
           ORDER BY updated_at ASC
           LIMIT ?
         )`
    );

    logger.info(`cacheDb: persistent SQLite cache opened at ${dbPath}`);
    return {
      kind: "sqlite",
      db,
      path: dbPath,
      stmtGet,
      stmtPut,
      stmtHit,
      stmtDelete,
      stmtClear,
      stmtCount,
      stmtSumHits,
      stmtSumSavings,
      stmtSumBytes,
      stmtList,
      stmtEvictOldest,
    };
  } catch (err) {
    logger.warn(
      `cacheDb: failed to open SQLite cache at ${dbPath}, using in-memory fallback: ${
        err instanceof Error ? err.message : err
      }`
    );
    return null;
  }
}

function ensureState(): SqlState | MemState {
  if (state) return state;
  const sqlState = tryOpenSqlite();
  if (sqlState) {
    state = sqlState;
  } else {
    state = { kind: "memory", map: new Map() };
    logger.info("cacheDb: using in-memory Map (cache will NOT persist across restarts)");
  }
  return state;
}

/** True if the persistent SQLite backend is active. */
export function isPersistent(): boolean {
  return ensureState().kind === "sqlite";
}

/** Internal: full path of the active database file (or "(memory)"). */
export function cacheDbPath(): string {
  const s = ensureState();
  return s.kind === "sqlite" ? s.path : "(memory)";
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export function getEntry(filePath: string): CacheEntryRow | null {
  const s = ensureState();
  if (s.kind === "sqlite") {
    const row = s.stmtGet.get(filePath) as CacheEntryRow | undefined;
    return row ?? null;
  }
  return s.map.get(filePath) ?? null;
}

export function putEntry(input: CacheEntryInput): CacheEntryRow {
  const s = ensureState();
  const now = Date.now();
  const row: CacheEntryRow = {
    filePath: input.filePath,
    hash: input.hash,
    content: input.content,
    tokens: input.tokens,
    originalTokens: input.originalTokens,
    type: input.type,
    hitCount: 0,
    updatedAt: now,
  };
  if (s.kind === "sqlite") {
    s.stmtPut.run({
      filePath: row.filePath,
      hash: row.hash,
      content: row.content,
      tokens: row.tokens,
      originalTokens: row.originalTokens,
      type: row.type,
      updatedAt: row.updatedAt,
    });
    enforceLruSqlite(s);
  } else {
    s.map.set(row.filePath, row);
    enforceLruMemory(s);
  }
  return row;
}

/**
 * Record a cache hit for an existing entry. Returns the updated row, or null
 * if no row exists with this filePath.
 */
export function recordHit(filePath: string): CacheEntryRow | null {
  const s = ensureState();
  const now = Date.now();
  if (s.kind === "sqlite") {
    const info = s.stmtHit.run(now, filePath);
    if (info.changes === 0) return null;
    return getEntry(filePath);
  }
  const row = s.map.get(filePath);
  if (!row) return null;
  row.hitCount += 1;
  row.updatedAt = now;
  return row;
}

export function deleteEntry(filePath: string): boolean {
  const s = ensureState();
  if (s.kind === "sqlite") {
    const info = s.stmtDelete.run(filePath);
    return info.changes > 0;
  }
  return s.map.delete(filePath);
}

export function clearAll(): number {
  const s = ensureState();
  if (s.kind === "sqlite") {
    const before = (s.stmtCount.get() as { n: number }).n;
    s.stmtClear.run();
    return before;
  }
  const before = s.map.size;
  s.map.clear();
  return before;
}

export function getStats(): CacheStats {
  const s = ensureState();
  if (s.kind === "sqlite") {
    const totalEntries = (s.stmtCount.get() as { n: number }).n;
    const totalHits = Number((s.stmtSumHits.get() as { s: number | bigint }).s);
    const totalTokensSaved = Number(
      (s.stmtSumSavings.get() as { s: number | bigint }).s
    );
    const rows = s.stmtList.all() as Array<{
      filePath: string;
      hitCount: number;
      tokensSaved: number;
      updatedAt: number;
    }>;
    const entries: CacheStatsRow[] = rows.map((r) => ({
      filePath: r.filePath,
      hitCount: r.hitCount,
      tokensSaved: r.tokensSaved,
      lastAccess: new Date(r.updatedAt).toISOString(),
    }));
    return { totalEntries, totalHits, totalTokensSaved, entries };
  }
  const entries: CacheStatsRow[] = [];
  let totalHits = 0;
  let totalTokensSaved = 0;
  for (const row of s.map.values()) {
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
  entries.sort((a, b) => (b.lastAccess > a.lastAccess ? 1 : -1));
  return {
    totalEntries: s.map.size,
    totalHits,
    totalTokensSaved,
    entries,
  };
}

// ─── LRU eviction ───────────────────────────────────────────────────────────

function enforceLruSqlite(s: SqlState): void {
  const count = (s.stmtCount.get() as { n: number }).n;
  if (count > MAX_ENTRIES) {
    s.stmtEvictOldest.run(count - MAX_ENTRIES);
  }
  // Byte cap: oldest-first eviction in small batches until under limit.
  // Capped at 100 iterations as a safety brake — content > 500 MB total
  // is already a misconfiguration we should not silently spin on.
  let bytes = Number((s.stmtSumBytes.get() as { s: number | bigint }).s);
  let safety = 100;
  while (bytes > MAX_BYTES && safety-- > 0) {
    s.stmtEvictOldest.run(Math.max(1, Math.floor(MAX_ENTRIES / 50)));
    bytes = Number((s.stmtSumBytes.get() as { s: number | bigint }).s);
  }
}

function enforceLruMemory(s: MemState): void {
  if (s.map.size <= MAX_ENTRIES) {
    let bytes = 0;
    for (const row of s.map.values()) bytes += row.content.length;
    if (bytes <= MAX_BYTES) return;
  }
  const rows = Array.from(s.map.values()).sort(
    (a, b) => a.updatedAt - b.updatedAt
  );
  let bytes = rows.reduce((acc, r) => acc + r.content.length, 0);
  let i = 0;
  while (
    (s.map.size > MAX_ENTRIES || bytes > MAX_BYTES) &&
    i < rows.length
  ) {
    bytes -= rows[i].content.length;
    s.map.delete(rows[i].filePath);
    i++;
  }
}

// ─── Shutdown ───────────────────────────────────────────────────────────────

/**
 * Close the cache database (if any). Safe to call multiple times.
 * Wired up to SIGINT/SIGTERM in src/main.ts.
 */
export function closeCacheDb(): void {
  if (!state) return;
  if (state.kind === "sqlite") {
    try {
      state.db.close();
      logger.info("cacheDb: SQLite cache closed cleanly");
    } catch (err) {
      logger.warn(
        `cacheDb: error closing SQLite cache: ${
          err instanceof Error ? err.message : err
        }`
      );
    }
  }
  state = null;
}
