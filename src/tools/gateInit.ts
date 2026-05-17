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
import { cacheDbPath, isPersistent, getStats } from "../lib/cacheDb.js";
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
    persistent: boolean;
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
  const reportPath = findGraphifyReport(projectRoot);
  const workspaceRoot = reportPath ? graphifyWorkspaceRoot(reportPath) : null;
  const staleWarning =
    reportPath && workspaceRoot
      ? graphifyStaleWarning(workspaceRoot, reportPath)
      : null;

  const stats = getStats();
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

  logger.info(`gate_init: root=${projectRoot} graphify=${reportPath ?? "none"}`);

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
      path: cacheDbPath(),
      persistent: isPersistent(),
      totalEntries: stats.totalEntries,
      totalHits: stats.totalHits,
      totalTokensSaved: stats.totalTokensSaved,
    },
    recommendedProjectRoots,
    note,
  };
}
