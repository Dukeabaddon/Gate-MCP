/**
 * Cache partition vs path-root scoping.
 *
 * Path checks may narrow to a child repo via tool `projectRoot`.
 * Dedup/SQLite rows always live under the trusted ceiling
 * (`GATE_PROJECT_ROOT` / startup cwd) so the same absolute file never
 * splits across parent vs child `root_key` partitions.
 */

import {
  getAllowedProjectRoot,
  isPathWithin,
} from "./pathGuard.js";
import { resolveCodeRoot } from "./projectRoot.js";
import {
  clearAll,
  deleteEntry,
  getStats,
  type CacheStats,
} from "./cacheDb.js";

/** Trusted ceiling used as the single SQLite / memory partition. */
export function resolveCachePartitionRoot(): string {
  return getAllowedProjectRoot();
}

/** Narrowed (or ceiling) root for file path resolution. */
export function resolvePathRoot(explicit?: string): string {
  return resolveCodeRoot(explicit);
}

function filterStats(all: CacheStats, scope: string): CacheStats {
  const entries = all.entries.filter((row) =>
    isPathWithin(scope, row.filePath)
  );
  let totalHits = 0;
  let totalTokensSaved = 0;
  for (const row of entries) {
    totalHits += row.hitCount;
    totalTokensSaved += row.tokensSaved;
  }
  return {
    totalEntries: entries.length,
    totalHits,
    totalTokensSaved,
    entries,
  };
}

/**
 * Persistent cache totals for a path scope.
 * Partition is always the allowed ceiling; optional pathRoot filters rows.
 */
export function getScopedStats(pathRoot?: string): CacheStats {
  const partition = resolveCachePartitionRoot();
  const scope = pathRoot ? resolvePathRoot(pathRoot) : partition;
  const all = getStats(partition);
  if (scope === partition) return all;
  return filterStats(all, scope);
}

/** Clear the whole partition, or only rows under a narrowed pathRoot. */
export function clearScoped(pathRoot?: string): number {
  const partition = resolveCachePartitionRoot();
  const scope = pathRoot ? resolvePathRoot(pathRoot) : partition;
  if (scope === partition) return clearAll(partition);

  const stats = getStats(partition);
  let removed = 0;
  for (const row of stats.entries) {
    if (!isPathWithin(scope, row.filePath)) continue;
    if (deleteEntry(row.filePath, undefined, partition)) removed += 1;
  }
  return removed;
}
