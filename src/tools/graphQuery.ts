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
import { queryGraphifyFromRoot } from "../lib/graphifyBridge.js";
import { resolveCodeRoot, findGraphifyReport } from "../lib/projectRoot.js";
import { countTextTokens } from "../lib/tokenCounter.js";
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

export async function handleGraphQuery(args: GraphQueryInput): Promise<GraphQueryResult> {
  const {
    query,
    projectRoot,
    queryType = "search",
    rebuild = false,
  } = args;

  if (rebuild) {
    invalidateGraph();
    logger.info("Graph cache invalidated by user request");
  }

  const resolvedRoot = resolveCodeRoot(projectRoot);
  const graphifyReport = findGraphifyReport(resolvedRoot);

  logger.info(
    `Graph query: "${query}" (type=${queryType}, root=${resolvedRoot}, graphify=${graphifyReport ?? "none"})`
  );

  if (GRAPHIFY_TYPES.has(queryType)) {
    const mode = queryType as "graphify_hubs" | "graphify_search" | "graphify_map";
    const g = queryGraphifyFromRoot(resolvedRoot, query, mode);
    const optimizedTokens = countTextTokens(g.result);
    return {
      query,
      queryType,
      result: g.result,
      nodesTraversed: g.found ? 1 : 0,
      originalTokens: 0,
      optimizedTokens,
      savingsPercent: 0,
      indexedRoot: resolvedRoot,
      graphifyReport: g.reportPath ?? graphifyReport,
      source: "graphify",
      note: g.reportPath
        ? `Graphify map from ${g.reportPath}. Pair with gate_compress_file for file bodies.`
        : g.result.slice(0, 200),
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
  const savingsPercent =
    response.originalTokens > 0
      ? Math.round(
          ((response.originalTokens - optimizedTokens) / response.originalTokens) * 100
        )
      : response.savingsPercent;

  const note =
    queryType === "stats"
      ? `Symbol graph: ${response.indexedRoot} (${response.nodesTraversed} nodes). ` +
        (graphifyReport ? `Graphify: ${graphifyReport}.` : "No graphify-out found.")
      : `Symbol query traversed ${nodesTraversed} node(s). ` +
        `~${optimizedTokens} tok vs ~${response.originalTokens} raw estimate. ` +
        (graphifyReport
          ? `Graphify map: ${path.relative(resolvedRoot, graphifyReport) || graphifyReport}.`
          : "Tip: run graphify update . for community map.");

  return {
    query: response.query,
    queryType: response.queryType,
    result,
    nodesTraversed,
    originalTokens: response.originalTokens,
    optimizedTokens,
    savingsPercent,
    indexedRoot: response.indexedRoot,
    graphifyReport,
    source,
    note,
  };
}
