/**
 * gate_session_stats — cumulative session savings from dedup cache.
 */

import { getStats, isPersistent } from "../lib/cacheDb.js";
import logger from "../lib/logger.js";
import { GATEMCP_VERSION } from "../version.js";

export interface SessionStatsResult {
  version: string;
  persistentCache: boolean;
  totalEntries: number;
  totalHits: number;
  totalTokensSaved: number;
  topEntries: Array<{
    filePath: string;
    hitCount: number;
    tokensSaved: number;
    lastAccess: string;
  }>;
  note: string;
}

export async function handleSessionStats(): Promise<SessionStatsResult> {
  const stats = getStats();
  const backend = isPersistent() ? "SQLite" : "memory";

  const note =
    `${backend} cache: ${stats.totalEntries} entries, ${stats.totalHits} hits, ` +
    `${stats.totalTokensSaved} tokens saved (cumulative). ` +
    `Workflow: gate_graph_query graphify_map → gate_compress_file signature → gate_help recommended_stack.`;

  logger.info(`gate_session_stats: ${stats.totalTokensSaved} tokens saved`);

  return {
    version: GATEMCP_VERSION,
    persistentCache: isPersistent(),
    totalEntries: stats.totalEntries,
    totalHits: stats.totalHits,
    totalTokensSaved: stats.totalTokensSaved,
    topEntries: stats.entries.slice(0, 10),
    note,
  };
}
