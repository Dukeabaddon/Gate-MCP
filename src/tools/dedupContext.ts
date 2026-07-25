/**
 * Gate Dedup Context — Cross-Session Content Deduplication (v0.4.0)
 *
 * Avoids repeated compression work for unchanged files. Explicit `check`
 * calls return a small reference-only result; `gate_compress_file` still
 * returns the cached compressed content when the caller needs to read it.
 * The cache is backed by
 * SQLite (via better-sqlite3) and persists across MCP server restarts and
 * across concurrent IDE sessions. When better-sqlite3 is unavailable, the
 * cache transparently degrades to an in-memory Map with identical API.
 *
 * How it works:
 * - First read: compress normally, persist the compressed content + SHA-256.
 * - Subsequent reads: detect unchanged content via hash, return a stub.
 * - File modified: detect hash mismatch, drop the row, re-compress, re-store.
 *
 * See src/lib/cacheDb.ts for the backing store and LRU eviction rules.
 */

import fs from "node:fs";
import crypto from "node:crypto";
import logger from "../lib/logger.js";
import { countTextTokens } from "../lib/tokenCounter.js";
import {
  getEntry,
  putEntry,
  recordHit,
  deleteEntry,
  isPersistent,
  COMPRESSOR_CACHE_VERSION,
  CACHE_SCHEMA_VERSION,
  type CacheIdentity,
  type CacheEntryRow,
} from "../lib/cacheDb.js";
import type { CompressionDepth } from "../types.js";
import { detectLanguage } from "../lib/astParser.js";
import { safeResolveExistingFile } from "../lib/pathGuard.js";
import {
  clearScoped,
  getScopedStats,
  resolveCachePartitionRoot,
  resolvePathRoot,
} from "../lib/cacheScope.js";

/**
 * Backwards-compatible CacheEntry shape returned to the rest of the codebase.
 * `timestamp` mirrors the row's updatedAt so existing callers keep working.
 */
export interface CacheEntry {
  hash: string;
  content: string;
  tokens: number;
  originalTokens: number;
  timestamp: number;
  hitCount: number;
  filePath: string;
  type: "file" | "image";
  depth: string;
  language: string;
  compressorVersion: string;
}

interface DedupResult {
  status: "cache_hit" | "cache_miss" | "cache_update" | "cache_stats";
  filePath?: string;
  hash?: string;
  cached?: boolean;
  hitCount?: number;
  originalTokens?: number;
  dedupTokens?: number;
  savingsPercent?: number;
  note?: string;
  content?: string;
  // Stats fields (for action: "stats")
  totalEntries?: number;
  totalHits?: number;
  totalTokensSaved?: number;
  entries?: Array<{
    filePath: string;
    hitCount: number;
    tokensSaved: number;
    lastAccess: string;
  }>;
}

/**
 * Reconcile response token fields with the response that is actually returned.
 * The token count includes its own numeric fields, so iterate to a fixed point.
 */
function withMeasuredPayload(result: DedupResult): DedupResult {
  if (!result.originalTokens) return result;

  let measured = result.dedupTokens ?? 0;
  for (let i = 0; i < 8; i += 1) {
    result.dedupTokens = measured;
    result.savingsPercent = Math.max(
      0,
      Math.round(
        ((result.originalTokens - measured) /
          Math.max(result.originalTokens, 1)) *
          100
      )
    );
    const next = countTextTokens(JSON.stringify(result));
    if (next === measured) return result;
    measured = next;
  }

  result.dedupTokens = countTextTokens(JSON.stringify(result));
  result.savingsPercent = Math.max(
    0,
    Math.round(
      ((result.originalTokens - result.dedupTokens) /
        Math.max(result.originalTokens, 1)) *
        100
    )
  );
  return result;
}

function computeFileHash(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function toLegacyEntry(row: CacheEntryRow): CacheEntry {
  return {
    hash: row.hash,
    content: row.content,
    tokens: row.tokens,
    originalTokens: row.originalTokens,
    timestamp: row.updatedAt,
    hitCount: row.hitCount,
    filePath: row.filePath,
    type: row.type,
    depth: row.depth,
    language: row.language,
    compressorVersion: row.compressorVersion,
  };
}

function compressionIdentity(
  hash: string,
  depth: string,
  language: string
): CacheIdentity {
  return {
    hash,
    depth,
    language,
    compressorVersion: COMPRESSOR_CACHE_VERSION,
    schemaVersion: CACHE_SCHEMA_VERSION,
  };
}

// ─── Handler ────────────────────────────────────────────────────────────────

export async function handleDedupContext(args: {
  action: "check" | "store" | "stats" | "clear";
  filePath?: string;
  content?: string;
  originalTokens?: number;
  type?: "file" | "image";
  projectRoot?: string;
}): Promise<DedupResult> {
  const { action } = args;
  const pathRoot = resolvePathRoot(args.projectRoot);
  const cacheRoot = resolveCachePartitionRoot();

  // ── Stats: aggregate cache analytics from the backing store ──
  if (action === "stats") {
    const stats = getScopedStats(pathRoot);
    const backend = isPersistent(cacheRoot) ? "SQLite" : "memory";
    return {
      status: "cache_stats",
      totalEntries: stats.totalEntries,
      totalHits: stats.totalHits,
      totalTokensSaved: stats.totalTokensSaved,
      entries: stats.entries,
      note: `${backend} cache partition=${cacheRoot} scope=${pathRoot}: ${stats.totalEntries} entries, ${stats.totalHits} hits, ${stats.totalTokensSaved} raw-vs-cached-view tokens avoided. Rows live under the GATE_PROJECT_ROOT partition; projectRoot only filters the view.`,
    };
  }

  // ── Clear: wipe scoped entries ──
  if (action === "clear") {
    const size = clearScoped(pathRoot);
    logger.info(
      `Session cache cleared (${size} entries removed) scope=${pathRoot} partition=${cacheRoot}`
    );
    return {
      status: "cache_stats",
      totalEntries: 0,
      totalHits: 0,
      totalTokensSaved: 0,
      note: `Cache cleared for scope ${pathRoot} (partition ${cacheRoot}). ${size} entries removed.`,
    };
  }

  // ── Check: look up file in cache ──
  if (action === "check") {
    if (!args.filePath) throw new Error("filePath required for 'check' action");

    const absPath = safeResolveExistingFile(args.filePath, {
      caller: "gate_dedup_context",
      projectRoot: pathRoot,
    });

    const currentHash = computeFileHash(absPath);
    const language = detectLanguage(absPath);
    const identity = compressionIdentity(currentHash, "explicit", language);
    const cached = getEntry(absPath, identity, cacheRoot);

    if (cached && cached.hash === currentHash) {
      const updated = recordHit(absPath, identity, cacheRoot) ?? cached;
      const savedThisHit = Math.max(0, updated.originalTokens - updated.tokens);

      logger.info(
        `Cache HIT: ${absPath} (hit #${updated.hitCount}, saved ${savedThisHit} tokens)`
      );

      return withMeasuredPayload({
        status: "cache_hit",
        filePath: absPath,
        hash: currentHash,
        cached: true,
        hitCount: updated.hitCount,
        originalTokens: updated.originalTokens,
        dedupTokens: 0,
        savingsPercent: 0,
        note:
          savedThisHit > 0
            ? `Cache hit #${updated.hitCount}. File unchanged (hash: ${currentHash}). Reference-only response; call gate_compress_file when cached content is required.`
            : `Cache hit #${updated.hitCount}. File unchanged (hash: ${currentHash}). Cached view is not smaller than raw content.`,
      });
    }

    // Surface auto-cache rows from gate_compress_file (signature/structure/…).
    const autoCached = getEntry(absPath, undefined, cacheRoot);
    if (autoCached && autoCached.hash === currentHash) {
      const autoIdentity = compressionIdentity(
        currentHash,
        autoCached.depth,
        autoCached.language
      );
      const updated = recordHit(absPath, autoIdentity, cacheRoot) ?? autoCached;
      return {
        status: "cache_hit",
        filePath: absPath,
        hash: currentHash,
        cached: true,
        hitCount: updated.hitCount,
        originalTokens: updated.originalTokens,
        note:
          `File is in the compress auto-cache (depth=${updated.depth}, hit #${updated.hitCount}). ` +
          `Call gate_compress_file again for the cached view; explicit store uses depth=explicit.`,
      };
    }

    if (autoCached && autoCached.hash !== currentHash) {
      logger.info(
        `Cache STALE: ${absPath} (old hash: ${autoCached.hash}, new: ${currentHash})`
      );
      deleteEntry(absPath, undefined, cacheRoot);
      return {
        status: "cache_update",
        filePath: absPath,
        hash: currentHash,
        cached: false,
        note: `File changed since last read (old: ${autoCached.hash}, new: ${currentHash}). Cache invalidated. Re-read with gate_compress_file.`,
      };
    }

    return {
      status: "cache_miss",
      filePath: absPath,
      hash: currentHash,
      cached: false,
      note: `File not in cache for scope ${pathRoot}. Read with gate_compress_file, then store with gate_dedup_context(action: "store").`,
    };
  }

  // ── Store: persist compressed content ──
  if (action === "store") {
    if (!args.filePath) throw new Error("filePath required for 'store' action");
    if (!args.content) throw new Error("content required for 'store' action");

    const absPath = safeResolveExistingFile(args.filePath, {
      caller: "gate_dedup_context",
      projectRoot: pathRoot,
    });
    const hash = computeFileHash(absPath);
    const tokens = countTextTokens(args.content);
    const originalTokens = args.originalTokens ?? tokens;
    const language = detectLanguage(absPath);

    putEntry(
      {
        filePath: absPath,
        hash,
        content: args.content,
        tokens,
        originalTokens,
        type: args.type ?? "file",
        depth: "explicit",
        language,
        compressorVersion: COMPRESSOR_CACHE_VERSION,
        schemaVersion: CACHE_SCHEMA_VERSION,
      },
      cacheRoot
    );

    logger.info(`Cached: ${absPath} (${tokens} tokens, hash: ${hash})`);

    return {
      status: "cache_miss",
      filePath: absPath,
      hash,
      cached: true,
      originalTokens,
      dedupTokens: tokens,
      savingsPercent: 0,
      note: `Stored in ${isPersistent(cacheRoot) ? "persistent" : "in-memory"} cache partition ${cacheRoot}. Explicit checks return a measured reference-only response; gate_compress_file returns the full cached view.`,
    };
  }

  throw new Error(`Unknown action: ${action}. Use 'check', 'store', 'stats', or 'clear'.`);
}

// ─── Auto-Caching Integration ───────────────────────────────────────────────
// These functions let gate_compress_file integrate with the dedup cache
// automatically, without requiring the AI to call two tools.

export function checkCache(
  filePath: string,
  depth: CompressionDepth,
  language: string,
  pathRoot?: string
): CacheEntry | null {
  try {
    const cacheRoot = resolveCachePartitionRoot();
    const absPath = safeResolveExistingFile(filePath, {
      caller: "gate_dedup_context:auto-check",
      projectRoot: pathRoot ?? cacheRoot,
    });
    const currentHash = computeFileHash(absPath);
    const identity = compressionIdentity(currentHash, depth, language);
    const cached = getEntry(absPath, identity, cacheRoot);
    if (!cached) {
      const latest = getEntry(absPath, undefined, cacheRoot);
      if (latest && latest.hash !== currentHash) {
        deleteEntry(absPath, undefined, cacheRoot);
      }
      return null;
    }
    if (cached.hash !== currentHash) {
      deleteEntry(absPath, undefined, cacheRoot);
      return null;
    }

    const updated = recordHit(absPath, identity, cacheRoot) ?? cached;
    const saved = Math.max(0, updated.originalTokens - updated.tokens);

    logger.info(
      `Auto-cache HIT: ${absPath} (hit #${updated.hitCount}, saved ${saved} tokens)`
    );
    return toLegacyEntry(updated);
  } catch {
    return null;
  }
}

export function storeInCache(
  filePath: string,
  content: string,
  originalTokens: number,
  type: "file" | "image" = "file",
  depth: CompressionDepth = "signature",
  language = detectLanguage(filePath),
  pathRoot?: string
): void {
  try {
    const cacheRoot = resolveCachePartitionRoot();
    const absPath = safeResolveExistingFile(filePath, {
      caller: "gate_dedup_context:auto-store",
      projectRoot: pathRoot ?? cacheRoot,
    });
    const hash = computeFileHash(absPath);
    const tokens = countTextTokens(content);

    putEntry(
      {
        filePath: absPath,
        hash,
        content,
        tokens,
        originalTokens,
        type,
        depth,
        language,
        compressorVersion: COMPRESSOR_CACHE_VERSION,
        schemaVersion: CACHE_SCHEMA_VERSION,
      },
      cacheRoot
    );

    logger.info(`Auto-cached: ${absPath} (${tokens} compressed tokens)`);
  } catch (err) {
    logger.warn(`Failed to cache ${filePath}: ${err}`);
  }
}
// Last reviewed: 2026-07-25 — unified cache partition + scoped stats/clear.
