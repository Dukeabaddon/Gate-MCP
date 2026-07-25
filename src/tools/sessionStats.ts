/**
 * gate_session_stats — measured process work plus persistent cache activity.
 */

import { isPersistent } from "../lib/cacheDb.js";
import {
  getScopedStats,
  resolveCachePartitionRoot,
  resolvePathRoot,
} from "../lib/cacheScope.js";
import logger from "../lib/logger.js";
import { GATEMCP_VERSION } from "../version.js";
import { getSessionMeasurements } from "../lib/sessionMetrics.js";
import { TOOL_PAYLOAD_BILLING_SCOPE } from "../lib/tokenCounter.js";

export interface SessionStatsResult {
  version: string;
  measurement_scope: "serialized_tool_result_excluding_mcp_envelope";
  /** Path scope used to filter persistent cache totals. */
  projectRoot: string;
  /** SQLite/memory partition (always GATE_PROJECT_ROOT / startup cwd). */
  cachePartition: string;
  /** Explicit: persistent totals are not Cursor billed tokens. */
  billingScope: "tool_payload_only";
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

export async function handleSessionStats(args: {
  projectRoot?: string;
} = {}): Promise<SessionStatsResult> {
  const projectRoot = resolvePathRoot(args.projectRoot);
  const cachePartition = resolveCachePartitionRoot();
  const stats = getScopedStats(projectRoot);
  const session = getSessionMeasurements();
  const backend = isPersistent(cachePartition) ? "SQLite" : "memory";

  const note =
    `${backend} partition=${cachePartition}; scoped view=${projectRoot}: ` +
    `${stats.totalEntries} entries, ${stats.totalHits} hits, ` +
    `${stats.totalTokensSaved} raw-vs-cached-view tokens avoided (cumulative; not attributed to cache lookup alone). ` +
    `Persistent totals honor projectRoot path filter; files_considered/cache_hits/bytes are process-wide for this MCP instance. ` +
    `billingScope=${TOOL_PAYLOAD_BILLING_SCOPE} (not Cursor billed tokens). ` +
    `Workflow: gate_graph_query graphify_map → gate_compress_file signature → gate_help recommended_stack.`;

  logger.info(
    `gate_session_stats: scope=${projectRoot} ${stats.totalTokensSaved} raw-vs-cached-view tokens avoided`
  );

  return {
    version: GATEMCP_VERSION,
    measurement_scope: "serialized_tool_result_excluding_mcp_envelope",
    projectRoot,
    cachePartition,
    billingScope: TOOL_PAYLOAD_BILLING_SCOPE,
    persistentCache: isPersistent(cachePartition),
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
