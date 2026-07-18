/**
 * gate_session_stats — measured process work plus persistent cache activity.
 */

import { getStats, isPersistent } from "../lib/cacheDb.js";
import logger from "../lib/logger.js";
import { GATEMCP_VERSION } from "../version.js";
import { getSessionMeasurements } from "../lib/sessionMetrics.js";

export interface SessionStatsResult {
  version: string;
  measurement_scope: "serialized_tool_result_excluding_mcp_envelope";
  persistentCache: boolean;
  totalEntries: number;
  totalHits: number;
  totalTokensSaved: number;
  files_considered: number;
  files_compressed: number;
  input_bytes: number;
  output_bytes: number;
  estimated_tokens_before: number;
  estimated_tokens_after: number;
  cache_hits: number;
  elapsed_ms: number;
  session_elapsed_ms: number;
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
  const session = getSessionMeasurements();
  const backend = isPersistent() ? "SQLite" : "memory";

  const note =
    `${backend} cache: ${stats.totalEntries} entries, ${stats.totalHits} hits, ` +
    `${stats.totalTokensSaved} raw-vs-cached-view tokens avoided (cumulative; not attributed to cache lookup alone). ` +
    `Workflow: gate_graph_query graphify_map → gate_compress_file signature → gate_help recommended_stack.`;

  logger.info(
    `gate_session_stats: ${stats.totalTokensSaved} raw-vs-cached-view tokens avoided`
  );

  return {
    version: GATEMCP_VERSION,
    measurement_scope: "serialized_tool_result_excluding_mcp_envelope",
    persistentCache: isPersistent(),
    totalEntries: stats.totalEntries,
    totalHits: stats.totalHits,
    totalTokensSaved: stats.totalTokensSaved,
    files_considered: session.filesConsidered,
    files_compressed: session.filesCompressed,
    input_bytes: session.inputBytes,
    output_bytes: session.outputBytes,
    estimated_tokens_before: session.estimatedTokensBefore,
    estimated_tokens_after: session.estimatedTokensAfter,
    cache_hits: session.cacheHits,
    elapsed_ms: Math.round(session.elapsedMs * 100) / 100,
    session_elapsed_ms: session.sessionElapsedMs,
    topEntries: stats.entries.slice(0, 10),
    note,
  };
}
