/**
 * gate_graph_query — Symbol graph (tree-sitter) + graphify-out bridge.
 */

import path from "node:path";
import { queryGraph, invalidateGraph } from "../lib/symbolGraph.js";
import type {
  GraphQueryType,
  GraphQueryResponse,
  SymbolQueryType,
} from "../lib/symbolGraph.js";
import {
  queryGraphifyFromRoot,
  countGraphifyReportTokens,
} from "../lib/graphifyBridge.js";
import { graphifyStaleWarning } from "../lib/graphifyFreshness.js";
import {
  runGraphifyUpdate,
  isGraphifyCliAvailable,
} from "../lib/graphifyRunner.js";
import {
  resolveCodeRoot,
  findGraphifyReport,
  graphifyWorkspaceRoot,
} from "../lib/projectRoot.js";
import { countTextTokens, calculateSavings, formatSavingsNote } from "../lib/tokenCounter.js";
import logger from "../lib/logger.js";

export interface GraphQueryInput {
  query: string;
  projectRoot?: string;
  queryType?: GraphQueryType;
  rebuild?: boolean;
}

export interface GraphQueryResult {
  query: string;
  queryType: string;
  result: string;
  nodesTraversed: number;
  originalTokens: number;
  optimizedTokens: number;
  savingsPercent: number;
  expanded?: boolean;
  indexedRoot: string;
  graphifyReport: string | null;
  source: "symbol" | "graphify" | "symbol+graphify";
  note: string;
}

const GRAPHIFY_TYPES = new Set<GraphQueryType>([
  "graphify_hubs",
  "graphify_search",
  "graphify_map",
]);

function graphifyMetrics(reportPath: string | undefined, resultText: string) {
  const originalTokens = reportPath ? countGraphifyReportTokens(reportPath) : 0;
  const optimizedTokens = countTextTokens(resultText);
  return calculateSavings(originalTokens, optimizedTokens);
}

export async function handleGraphQuery(args: GraphQueryInput): Promise<GraphQueryResult> {
  const {
    query,
    projectRoot,
    queryType = "search",
    rebuild = false,
  } = args;

  const resolvedRoot = resolveCodeRoot(projectRoot);
  let graphifyRebuildNote: string | null = null;

  if (rebuild) {
    invalidateGraph();
    logger.info("Graph cache invalidated by user request");

    const reportForRebuild = findGraphifyReport(resolvedRoot);
    if (reportForRebuild) {
      const ws = graphifyWorkspaceRoot(reportForRebuild);
      if (isGraphifyCliAvailable()) {
        const upd = runGraphifyUpdate(ws);
        graphifyRebuildNote = upd.ok
          ? `Graphify: ${upd.message}`
          : `Graphify rebuild skipped: ${upd.message}`;
      } else {
        graphifyRebuildNote =
          "Graphify: CLI not on PATH — symbol graph rebuilt only. Install graphifyy for map refresh.";
      }
    }
  }

  const graphifyReport = findGraphifyReport(resolvedRoot);

  logger.info(
    `Graph query: "${query}" (type=${queryType}, root=${resolvedRoot}, graphify=${graphifyReport ?? "none"})`
  );

  if (GRAPHIFY_TYPES.has(queryType)) {
    const mode = queryType as "graphify_hubs" | "graphify_search" | "graphify_map";
    const g = queryGraphifyFromRoot(resolvedRoot, query, mode);
    const reportPath = g.reportPath ?? graphifyReport ?? undefined;
    const metrics = graphifyMetrics(reportPath, g.result);
    const { originalTokens, optimizedTokens, savingsPercent, expanded } = metrics;

    const stale = reportPath ? graphifyStaleWarning(resolvedRoot, reportPath) : null;
    const savingsDetail =
      reportPath && originalTokens > 0
        ? `vs full GRAPH_REPORT.md (~${originalTokens} tok).`
        : "Pair with gate_compress_file for file bodies.";

    const baseNote = g.reportPath
      ? `Graphify map from ${g.reportPath}. ${savingsDetail}`
      : g.result.slice(0, 200);

    const noteParts = [
      formatSavingsNote(metrics, baseNote),
      stale,
      graphifyRebuildNote,
    ].filter(Boolean);

    return {
      query,
      queryType,
      result: g.result,
      nodesTraversed: g.found ? 1 : 0,
      originalTokens,
      optimizedTokens,
      savingsPercent,
      expanded,
      indexedRoot: resolvedRoot,
      graphifyReport: reportPath ?? null,
      source: "graphify",
      note: noteParts.join(" "),
    };
  }

  const response: GraphQueryResponse = queryGraph(
    resolvedRoot,
    query,
    queryType as SymbolQueryType
  );

  let result = response.result;
  let source: GraphQueryResult["source"] = "symbol";
  let nodesTraversed = response.nodesTraversed;

  if (
    queryType === "search" &&
    nodesTraversed === 0 &&
    graphifyReport
  ) {
    const fallback = queryGraphifyFromRoot(resolvedRoot, query, "graphify_search");
    if (fallback.reportPath) {
      result = `${response.result}\n\n--- graphify fallback ---\n${fallback.result}`;
      source = "symbol+graphify";
      if (fallback.found) nodesTraversed = 1;
    }
  }

  const optimizedTokens = countTextTokens(result);
  const metrics = calculateSavings(response.originalTokens, optimizedTokens);
  const savingsPercent = metrics.savingsPercent;

  const stale = graphifyReport ? graphifyStaleWarning(resolvedRoot, graphifyReport) : null;

  const rebuildSuffix = graphifyRebuildNote ? ` ${graphifyRebuildNote}` : "";

  const note =
    queryType === "stats"
      ? `Symbol graph: ${response.indexedRoot} (${response.nodesTraversed} nodes). ` +
        (graphifyReport ? `Graphify: ${graphifyReport}.` : "No graphify-out found.") +
        (stale ? ` ${stale}` : "") +
        rebuildSuffix
      : formatSavingsNote(
          metrics,
          `Symbol query traversed ${nodesTraversed} node(s). ` +
            (graphifyReport
              ? `Graphify map: ${path.relative(resolvedRoot, graphifyReport) || graphifyReport}.`
              : "Tip: run graphify update . for community map.")
        ) +
        (stale ? ` ${stale}` : "") +
        rebuildSuffix;

  return {
    query: response.query,
    queryType: response.queryType,
    result,
    nodesTraversed,
    originalTokens: response.originalTokens,
    optimizedTokens,
    savingsPercent,
    expanded: metrics.expanded,
    indexedRoot: response.indexedRoot,
    graphifyReport,
    source,
    note,
  };
}
