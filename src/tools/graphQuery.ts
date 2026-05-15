/**
 * gate_graph_query — Symbol Dependency Graph tool.
 *
 * Builds an in-memory graph of cross-file symbol dependencies using tree-sitter.
 * Answers queries like "what does X depend on?" in <300 tokens
 * instead of reading entire files (>2,000 tokens each).
 *
 * This is our Graphify equivalent for code files —
 * no Python, no CLI, no 2M limit, fully in-process.
 */

import path from "node:path";
import { queryGraph, invalidateGraph } from "../lib/symbolGraph.js";
import type { GraphQueryResponse } from "../lib/symbolGraph.js";
import logger from "../lib/logger.js";

export interface GraphQueryInput {
  query: string;
  projectRoot?: string;
  queryType?: "depends_on" | "dependents" | "file_symbols" | "search" | "stats";
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
  note: string;
}

export async function handleGraphQuery(args: GraphQueryInput): Promise<GraphQueryResult> {
  const {
    query,
    projectRoot = process.cwd(),
    queryType = "search",
    rebuild = false,
  } = args;

  // Invalidate cache if rebuild requested
  if (rebuild) {
    invalidateGraph();
    logger.info("Graph cache invalidated by user request");
  }

  const resolvedRoot = path.resolve(projectRoot);

  logger.info(
    `Graph query: "${query}" (type=${queryType}, root=${resolvedRoot})`
  );

  const response: GraphQueryResponse = queryGraph(resolvedRoot, query, queryType);

  const note =
    queryType === "stats"
      ? `Graph stats for ${resolvedRoot}. Built from ${response.nodesTraversed} nodes.`
      : `Graph query "${query}" traversed ${response.nodesTraversed} nodes. ` +
        `Response: ${response.optimizedTokens} tokens vs ~${response.originalTokens} estimated for raw file reads ` +
        `(${response.savingsPercent}% saved).`;

  return {
    query: response.query,
    queryType: response.queryType,
    result: response.result,
    nodesTraversed: response.nodesTraversed,
    originalTokens: response.originalTokens,
    optimizedTokens: response.optimizedTokens,
    savingsPercent: response.savingsPercent,
    note,
  };
}
// Last reviewed: 2026-05-15 — verified against v0.3.2 fidelity test suite.
