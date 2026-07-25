/**
 * gate_init — health / onboarding for a project root.
 */

import path from "node:path";
import {
  findGraphifyReport,
  graphifyWorkspaceRoot,
  resolveCodeRoot,
} from "../lib/projectRoot.js";
import { graphifyStaleWarning } from "../lib/graphifyFreshness.js";
import { isGraphifyCliAvailable } from "../lib/graphifyRunner.js";
import { cacheBackendInfo } from "../lib/cacheDb.js";
import {
  getScopedStats,
  resolveCachePartitionRoot,
} from "../lib/cacheScope.js";
import { GATEMCP_VERSION } from "../version.js";
import logger from "../lib/logger.js";

export interface GateInitResult {
  version: string;
  projectRoot: string;
  mcpSlugHint: string;
  graphifyCli: boolean;
  graphify: {
    found: boolean;
    reportPath: string | null;
    workspaceRoot: string | null;
    staleWarning: string | null;
  };
  cache: {
    path: string;
    kind: "sqlite" | "memory";
    persistent: boolean;
    /** Present when persistent=false — explains why GATE_CACHE_DB was not used. */
    fallbackReason?: string;
    partition: string;
    totalEntries: number;
    totalHits: number;
    totalTokensSaved: number;
  };
  recommendedProjectRoots: string[];
  note: string;
}

export async function handleGateInit(args: {
  projectRoot?: string;
}): Promise<GateInitResult> {
  const projectRoot = resolveCodeRoot(args.projectRoot);
  const partition = resolveCachePartitionRoot();
  const reportPath = findGraphifyReport(projectRoot);
  const workspaceRoot = reportPath ? graphifyWorkspaceRoot(reportPath) : null;
  const staleWarning =
    reportPath && workspaceRoot
      ? graphifyStaleWarning(workspaceRoot, reportPath)
      : null;

  const stats = getScopedStats(projectRoot);
  const backend = cacheBackendInfo(partition);
  const graphifyCli = isGraphifyCliAvailable();

  const recommendedProjectRoots: string[] = [projectRoot];
  if (workspaceRoot && workspaceRoot !== projectRoot) {
    recommendedProjectRoots.push(workspaceRoot);
  }

  const mcpSlugHint =
    "In Cursor MCP settings the server may appear as user-gatemcp (not gatemcp). " +
    "Use the enabled gatemcp / @gatemcp/cli server from your mcp.json.";

  let note =
    `gatemcp v${GATEMCP_VERSION} ready. ` +
    `Start: gate_help tool='recommended_stack'. ` +
    `Stats: gate_session_stats.`;

  if (!reportPath) {
    note += " No graphify-out found — run `graphify update .` in your code folder for map queries.";
  } else if (staleWarning) {
    note += ` ${staleWarning}`;
  } else if (reportPath) {
    note += ` Graphify map: ${path.relative(projectRoot, reportPath) || reportPath}.`;
  }

  if (!backend.persistent) {
    note +=
      ` Cache is in-memory (not durable).` +
      (backend.fallbackReason
        ? ` Reason: ${backend.fallbackReason}.`
        : " Reason unknown — check better-sqlite3 install / GATE_CACHE_DB path.") +
      ` GATE_CACHE_DB is attempted; persistence fails only when SQLite cannot open.`;
  }

  logger.info(
    `gate_init: root=${projectRoot} graphify=${reportPath ?? "none"} cache=${backend.kind}`
  );

  return {
    version: GATEMCP_VERSION,
    projectRoot,
    mcpSlugHint,
    graphifyCli,
    graphify: {
      found: Boolean(reportPath),
      reportPath,
      workspaceRoot,
      staleWarning,
    },
    cache: {
      path: backend.persistent ? backend.path : "(memory)",
      kind: backend.kind,
      persistent: backend.persistent,
      ...(backend.fallbackReason
        ? { fallbackReason: backend.fallbackReason }
        : {}),
      partition,
      totalEntries: stats.totalEntries,
      totalHits: stats.totalHits,
      totalTokensSaved: stats.totalTokensSaved,
    },
    recommendedProjectRoots,
    note,
  };
}
