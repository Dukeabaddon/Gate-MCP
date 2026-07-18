#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import {
  CACHE_SCHEMA_VERSION,
  COMPRESSOR_CACHE_VERSION,
  cacheBackendInfo,
  clearAll,
  closeAllCacheDbs,
  closeCacheDb,
  getEntry,
  getStats,
  putEntry,
  type CacheIdentity,
} from "./lib/cacheDb.js";
import {
  MAX_MEMORY_BYTES,
  _resetMemoryDbForTests,
  closeAllMemoryDbs,
  isMemoryPersistent,
  memoryCount,
  memoryGet,
  memoryPut,
} from "./lib/memoryDb.js";

const require = createRequire(import.meta.url);
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gatemcp-storage-"));
const rootA = path.join(fixtureRoot, "project-a");
const rootB = path.join(fixtureRoot, "project-b");
fs.mkdirSync(rootA, { recursive: true });
fs.mkdirSync(rootB, { recursive: true });

const previousProjectRoot = process.env.GATE_PROJECT_ROOT;
const previousCacheDb = process.env.GATE_CACHE_DB;
const previousForceJson = process.env.GATE_FORCE_JSON_MEMORY;
process.env.GATE_PROJECT_ROOT = fixtureRoot;
delete process.env.GATE_CACHE_DB;

function hash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function identity(
  contentHash: string,
  depth: string,
  language = "typescript"
): CacheIdentity {
  return {
    hash: contentHash,
    depth,
    language,
    compressorVersion: COMPRESSOR_CACHE_VERSION,
  };
}

function cacheInput(
  filePath: string,
  contentHash: string,
  depth: string,
  content: string
) {
  return {
    filePath,
    hash: contentHash,
    depth,
    language: "typescript",
    compressorVersion: COMPRESSOR_CACHE_VERSION,
    content,
    tokens: content.length,
    originalTokens: 100,
    type: "file" as const,
  };
}

function sqliteConstructor(): typeof import("better-sqlite3") | null {
  try {
    const Database = require("better-sqlite3") as typeof import("better-sqlite3");
    const probe = new Database(":memory:");
    probe.close();
    return Database;
  } catch {
    return null;
  }
}

function assertPrivateMode(target: string, expected: number): void {
  if (process.platform === "win32") return;
  assert.equal(
    fs.statSync(target).mode & 0o777,
    expected,
    `${target} permissions are not ${expected.toString(8)}`
  );
}

try {
  closeAllCacheDbs();
  closeAllMemoryDbs();

  const sourceA = path.join(rootA, "shared.ts");
  const sourceB = path.join(rootB, "shared.ts");
  const sourceText = "export function shared(): number { return 1; }\n";
  fs.writeFileSync(sourceA, sourceText, "utf8");
  fs.writeFileSync(sourceB, sourceText, "utf8");
  const sourceHash = hash(sourceText);

  // Same path and hash, different views: both must coexist.
  putEntry(
    cacheInput(sourceA, sourceHash, "signature", "signature-view"),
    rootA
  );
  putEntry(
    cacheInput(sourceA, sourceHash, "summary", "summary-view"),
    rootA
  );
  const rootAGateDir = path.join(rootA, ".gate-mcp");
  const rootADbPath = path.join(rootAGateDir, "cache.db");
  if (cacheBackendInfo(rootA).persistent) {
    assertPrivateMode(rootAGateDir, 0o700);
    assertPrivateMode(rootADbPath, 0o600);
    for (const sidecar of [`${rootADbPath}-wal`, `${rootADbPath}-shm`]) {
      if (fs.existsSync(sidecar)) assertPrivateMode(sidecar, 0o600);
    }
  }
  assert.equal(
    getEntry(sourceA, identity(sourceHash, "signature"), rootA)?.content,
    "signature-view"
  );
  assert.equal(
    getEntry(sourceA, identity(sourceHash, "summary"), rootA)?.content,
    "summary-view"
  );
  assert.equal(
    getEntry(sourceA, identity(hash("changed"), "signature"), rootA),
    null
  );
  assert.equal(getStats(rootA).totalEntries, 2);

  // Project-root keyed states must not share clear/stats/content.
  putEntry(
    cacheInput(sourceB, sourceHash, "signature", "project-b-view"),
    rootB
  );
  assert.equal(getStats(rootB).totalEntries, 1);
  assert.equal(clearAll(rootA), 2);
  assert.equal(getStats(rootA).totalEntries, 0);
  assert.equal(
    getEntry(sourceB, identity(sourceHash, "signature"), rootB)?.content,
    "project-b-view"
  );

  // Restart behavior is backend-specific and observable.
  putEntry(
    cacheInput(sourceA, sourceHash, "signature", "restart-view"),
    rootA
  );
  const cachePersistent = cacheBackendInfo(rootA).persistent;
  closeCacheDb(rootA);
  const afterRestart = getEntry(
    sourceA,
    identity(sourceHash, "signature"),
    rootA
  );
  if (cachePersistent) {
    assert.equal(afterRestart?.content, "restart-view");
  } else {
    assert.equal(afterRestart, null);
  }

  // Even an explicitly shared SQLite path must scope clear/stats by root.
  closeAllCacheDbs();
  process.env.GATE_CACHE_DB = path.join(fixtureRoot, "shared-cache.db");
  putEntry(
    cacheInput(sourceA, sourceHash, "signature", "shared-db-a"),
    rootA
  );
  putEntry(
    cacheInput(sourceB, sourceHash, "signature", "shared-db-b"),
    rootB
  );
  if (cacheBackendInfo(rootA).persistent) {
    assertPrivateMode(process.env.GATE_CACHE_DB, 0o600);
  }
  assert.equal(getStats(rootA).totalEntries, 1);
  assert.equal(getStats(rootB).totalEntries, 1);
  assert.equal(clearAll(rootA), 1);
  assert.equal(getStats(rootA).totalEntries, 0);
  assert.equal(getStats(rootB).totalEntries, 1);
  closeAllCacheDbs();
  delete process.env.GATE_CACHE_DB;

  // SQLite initialization failures must remain observable, non-fatal, and
  // identity-correct through the in-memory fallback.
  const fallbackRoot = path.join(fixtureRoot, "cache-fallback");
  fs.mkdirSync(fallbackRoot, { recursive: true });
  const blockedParent = path.join(fixtureRoot, "blocked-cache-parent");
  fs.writeFileSync(blockedParent, "not a directory", "utf8");
  process.env.GATE_CACHE_DB = path.join(blockedParent, "cache.db");
  const fallbackFile = path.join(fallbackRoot, "fallback.ts");
  fs.writeFileSync(fallbackFile, sourceText, "utf8");
  putEntry(
    cacheInput(fallbackFile, sourceHash, "signature", "fallback-view"),
    fallbackRoot
  );
  const fallbackInfo = cacheBackendInfo(fallbackRoot);
  assert.equal(fallbackInfo.kind, "memory");
  assert.ok(fallbackInfo.fallbackReason);
  assert.equal(
    getEntry(
      fallbackFile,
      identity(sourceHash, "signature"),
      fallbackRoot
    )?.content,
    "fallback-view"
  );
  closeCacheDb(fallbackRoot);
  delete process.env.GATE_CACHE_DB;

  // Legacy SQLite rows stay available to older Gate versions while v3 uses a
  // side-by-side identity-safe table.
  let sqliteMigrationChecked = false;
  let memoryRollbackChecked = false;
  const Database = sqliteConstructor();
  if (Database) {
    const migrationRoot = path.join(fixtureRoot, "migration");
    const gateDir = path.join(migrationRoot, ".gate-mcp");
    const dbPath = path.join(gateDir, "cache.db");
    fs.mkdirSync(gateDir, { recursive: true });
    const legacyDb = new Database(dbPath);
    legacyDb.exec(
      `CREATE TABLE cache_entries (
         file_path TEXT PRIMARY KEY,
         hash TEXT NOT NULL,
         content TEXT NOT NULL,
         tokens INTEGER NOT NULL,
         original_tokens INTEGER NOT NULL,
         type TEXT NOT NULL,
         hit_count INTEGER NOT NULL,
         updated_at INTEGER NOT NULL
       );
       CREATE TABLE cache_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
       INSERT INTO cache_meta VALUES ('schema_version', '1');
       INSERT INTO cache_entries VALUES
         ('legacy.ts', 'old', 'stale', 1, 10, 'file', 0, 1);`
    );
    legacyDb.close();

    assert.equal(cacheBackendInfo(migrationRoot).persistent, true);
    assert.equal(getStats(migrationRoot).totalEntries, 0);
    closeCacheDb(migrationRoot);
    const migratedDb = new Database(dbPath, { readonly: true });
    const legacySchema = migratedDb
      .prepare("SELECT value FROM cache_meta WHERE key = 'schema_version'")
      .get() as { value: string };
    const schema = migratedDb
      .prepare("SELECT value FROM cache_meta WHERE key = 'schema_version_v3'")
      .get() as { value: string };
    const legacyRows = migratedDb
      .prepare("SELECT COUNT(*) AS count FROM cache_entries")
      .get() as { count: number };
    assert.equal(legacySchema.value, "1");
    assert.equal(schema.value, String(CACHE_SCHEMA_VERSION));
    assert.equal(legacyRows.count, 1);
    migratedDb.close();
    sqliteMigrationChecked = true;

    const rcRoot = path.join(fixtureRoot, "release-candidate-migration");
    const rcGateDir = path.join(rcRoot, ".gate-mcp");
    const rcDbPath = path.join(rcGateDir, "cache.db");
    fs.mkdirSync(rcGateDir, { recursive: true });
    const rcDb = new Database(rcDbPath);
    rcDb.exec(
      `CREATE TABLE cache_entries (
         cache_key TEXT NOT NULL,
         root_key TEXT NOT NULL,
         file_path TEXT NOT NULL,
         hash TEXT NOT NULL,
         depth TEXT NOT NULL,
         language TEXT NOT NULL,
         compressor_version TEXT NOT NULL,
         schema_version INTEGER NOT NULL,
         content TEXT NOT NULL,
         tokens INTEGER NOT NULL,
         original_tokens INTEGER NOT NULL,
         type TEXT NOT NULL,
         hit_count INTEGER NOT NULL,
         updated_at INTEGER NOT NULL,
         PRIMARY KEY(root_key, cache_key)
       );
       CREATE TABLE cache_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
       INSERT INTO cache_meta VALUES ('schema_version', '3');
       INSERT INTO cache_entries VALUES
         ('rc-key', '${rcRoot}', '${path.join(rcRoot, "rc.ts")}', 'rc-hash',
          'signature', 'typescript', '${COMPRESSOR_CACHE_VERSION}', 3,
          'rc-view', 2, 10, 'file', 0, 1);`
    );
    rcDb.close();

    assert.equal(cacheBackendInfo(rcRoot).persistent, true);
    assert.equal(getStats(rcRoot).totalEntries, 1);
    closeCacheDb(rcRoot);
    const compatibleDb = new Database(rcDbPath, { readonly: true });
    const legacyColumns = compatibleDb
      .prepare("PRAGMA table_info(cache_entries)")
      .all() as Array<{ name: string }>;
    const migratedRows = compatibleDb
      .prepare("SELECT COUNT(*) AS count FROM cache_entries_v3")
      .get() as { count: number };
    assert.ok(!legacyColumns.some((column) => column.name === "cache_key"));
    assert.equal(migratedRows.count, 1);
    compatibleDb.close();

    const memoryRollbackRoot = path.join(fixtureRoot, "memory-rollback");
    const memoryRollbackDir = path.join(memoryRollbackRoot, ".gate-mcp");
    const memoryRollbackPath = path.join(memoryRollbackDir, "cache.db");
    fs.mkdirSync(memoryRollbackDir, { recursive: true });
    const oldMemoryDb = new Database(memoryRollbackPath);
    oldMemoryDb.exec(
      `CREATE TABLE memory_entries (
         mem_key TEXT PRIMARY KEY,
         value TEXT NOT NULL,
         updated_at INTEGER NOT NULL
       );
       CREATE INDEX idx_memory_updated ON memory_entries(updated_at);
       INSERT INTO memory_entries VALUES ('legacy-key', 'legacy-value', 1);`
    );
    oldMemoryDb.close();

    assert.equal(memoryGet(memoryRollbackRoot, "legacy-key"), "legacy-value");
    memoryPut(memoryRollbackRoot, "scoped-key", "scoped-value");
    _resetMemoryDbForTests();
    const rollbackDb = new Database(memoryRollbackPath);
    const rollbackColumns = rollbackDb
      .prepare("PRAGMA table_info(memory_entries)")
      .all() as Array<{ name: string }>;
    const scopedMemoryRows = rollbackDb
      .prepare("SELECT COUNT(*) AS count FROM memory_entries_v2")
      .get() as { count: number };
    assert.ok(!rollbackColumns.some((column) => column.name === "root_key"));
    assert.equal(scopedMemoryRows.count, 2);
    rollbackDb
      .prepare(
        `INSERT INTO memory_entries(mem_key, value, updated_at)
         VALUES (?, ?, ?)`
      )
      .run("rollback-write", "works", 2);
    rollbackDb.close();
    memoryRollbackChecked = true;
  }

  // gate_memory project isolation and persistence across module reset.
  memoryPut(rootA, "same-key", "value-a");
  memoryPut(rootB, "same-key", "value-b");
  assert.equal(memoryGet(rootA, "same-key"), "value-a");
  assert.equal(memoryGet(rootB, "same-key"), "value-b");
  const memoryPersistent = isMemoryPersistent(rootA);
  _resetMemoryDbForTests();
  assert.equal(memoryGet(rootA, "same-key"), "value-a");
  assert.equal(memoryGet(rootB, "same-key"), "value-b");

  // Force JSON fallback so atomicity/LRU are covered even on SQLite hosts.
  const jsonRoot = path.join(fixtureRoot, "json-fallback");
  fs.mkdirSync(jsonRoot, { recursive: true });
  process.env.GATE_FORCE_JSON_MEMORY = "1";
  const legacyJsonRoot = path.join(fixtureRoot, "legacy-json-permissions");
  const legacyJsonDirectory = path.join(legacyJsonRoot, ".gate-mcp");
  const legacyJsonPath = path.join(legacyJsonDirectory, "memory.json");
  fs.mkdirSync(legacyJsonDirectory, { recursive: true, mode: 0o755 });
  fs.writeFileSync(
    legacyJsonPath,
    JSON.stringify({ legacy: "read-only-value" }),
    { mode: 0o644 }
  );
  if (process.platform !== "win32") {
    fs.chmodSync(legacyJsonDirectory, 0o755);
    fs.chmodSync(legacyJsonPath, 0o644);
  }
  assert.equal(memoryGet(legacyJsonRoot, "legacy"), "read-only-value");
  assertPrivateMode(legacyJsonDirectory, 0o700);
  assertPrivateMode(legacyJsonPath, 0o600);

  const largeValue = "x".repeat(Math.floor(MAX_MEMORY_BYTES * 0.6));
  memoryPut(jsonRoot, "large-old", largeValue);
  memoryPut(jsonRoot, "large-new", largeValue);
  assert.equal(isMemoryPersistent(jsonRoot), false);
  assert.equal(memoryCount(jsonRoot), 1);
  assert.equal(memoryGet(jsonRoot, "large-old"), undefined);
  assert.equal(memoryGet(jsonRoot, "large-new")?.length, largeValue.length);

  const jsonGateDir = path.join(jsonRoot, ".gate-mcp");
  const jsonPath = path.join(jsonGateDir, "memory.json");
  const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as {
    version: number;
  };
  assert.equal(parsed.version, 1);
  assertPrivateMode(jsonGateDir, 0o700);
  assertPrivateMode(jsonPath, 0o600);
  const leftovers = fs
    .readdirSync(jsonGateDir)
    .filter((name) => name.endsWith(".tmp") || name.endsWith(".lock"));
  assert.deepEqual(leftovers, []);
  _resetMemoryDbForTests();
  assert.equal(memoryGet(jsonRoot, "large-new")?.length, largeValue.length);
  const jsonAtomicityChecked = true;
  delete process.env.GATE_FORCE_JSON_MEMORY;

  process.stdout.write(
    `${JSON.stringify(
      {
        passed: true,
        cacheBackend: cacheBackendInfo(rootA).kind,
        cacheIdentityVariants: 2,
        projectIsolation: true,
        cacheRestartChecked: true,
        cacheFallbackChecked: true,
        sqliteMigrationChecked,
        memoryRollbackChecked,
        memoryBackend: isMemoryPersistent(rootA) ? "sqlite" : "json",
        memoryRestartChecked: true,
        jsonAtomicityChecked,
        privateStorageModesChecked: process.platform !== "win32",
      },
      null,
      2
    )}\n`
  );
} finally {
  closeAllCacheDbs();
  closeAllMemoryDbs();
  if (previousProjectRoot === undefined) delete process.env.GATE_PROJECT_ROOT;
  else process.env.GATE_PROJECT_ROOT = previousProjectRoot;
  if (previousCacheDb === undefined) delete process.env.GATE_CACHE_DB;
  else process.env.GATE_CACHE_DB = previousCacheDb;
  if (previousForceJson === undefined) delete process.env.GATE_FORCE_JSON_MEMORY;
  else process.env.GATE_FORCE_JSON_MEMORY = previousForceJson;
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
