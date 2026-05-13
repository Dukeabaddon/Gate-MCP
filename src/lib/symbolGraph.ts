/**
 * Symbol Dependency Graph Engine.
 *
 * Builds an in-memory graph of cross-file symbol relationships using tree-sitter.
 * Answers queries like "what does X depend on?" with <300 tokens
 * instead of dumping entire files (>2,000 tokens).
 *
 * This is Gate-MCP's equivalent of Graphify's BFS subgraph traversal,
 * but runs in-process (no Python, no CLI, no 2M limit).
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { detectLanguage, extractSignatures } from "./astParser.js";
import { countTextTokens } from "./tokenCounter.js";
import logger from "./logger.js";
import type { SupportedLanguage } from "../types.js";

const require = createRequire(import.meta.url);

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SymbolNode {
  name: string;
  kind: "function" | "class" | "import" | "export" | "module";
  file: string;
  line?: number;
}

export interface SymbolEdge {
  from: string; // symbol name or file
  to: string; // symbol name or file
  kind: "imports" | "calls" | "exports" | "contains";
}

export interface SymbolGraph {
  nodes: Map<string, SymbolNode>;
  edges: SymbolEdge[];
  fileIndex: Map<string, string[]>; // file → symbol names
  buildTimeMs: number;
  fileCount: number;
}

export interface GraphQueryResponse {
  query: string;
  queryType: "depends_on" | "dependents" | "file_symbols" | "search" | "stats";
  result: string;
  nodesTraversed: number;
  originalTokens: number;
  optimizedTokens: number;
  savingsPercent: number;
}

// ─── Singleton graph cache ──────────────────────────────────────────────────

let cachedGraph: SymbolGraph | null = null;
let cachedProjectRoot: string | null = null;

// ─── File discovery ─────────────────────────────────────────────────────────

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "__pycache__",
  ".turbo", "coverage", ".nyc_output", ".cache", "vendor",
  ".venv", "venv", "env", ".env", ".tox",
]);

const SUPPORTED_EXTENSIONS = new Set([
  ".js", ".jsx", ".mjs", ".ts", ".tsx", ".py",
]);

function discoverFiles(dir: string, maxFiles = 1000): string[] {
  const files: string[] = [];

  function walk(currentDir: string): void {
    if (files.length >= maxFiles) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) break;

      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
          walk(path.join(currentDir, entry.name));
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SUPPORTED_EXTENSIONS.has(ext)) {
          files.push(path.join(currentDir, entry.name));
        }
      }
    }
  }

  walk(dir);
  return files;
}

// ─── Import resolution ──────────────────────────────────────────────────────

/**
 * Parse an import statement to extract the module path and imported names.
 */
function parseImport(
  importText: string,
  language: SupportedLanguage
): { source: string; names: string[] } | null {
  if (language === "python") {
    // "from pathlib import Path" → { source: "pathlib", names: ["Path"] }
    // "import os" → { source: "os", names: ["os"] }
    const fromMatch = importText.match(/from\s+(\S+)\s+import\s+(.+)/);
    if (fromMatch) {
      const names = fromMatch[2].split(",").map((n) => n.trim().split(" as ")[0].trim());
      return { source: fromMatch[1], names };
    }
    const importMatch = importText.match(/import\s+(\S+)/);
    if (importMatch) {
      return { source: importMatch[1], names: [importMatch[1]] };
    }
    return null;
  }

  // JS/TS: import { x, y } from "./module"
  // import z from "./module"
  // import * as z from "./module"
  const match = importText.match(
    /import\s+(?:(?:\{([^}]+)\}|(\*\s+as\s+\w+)|(\w+))(?:\s*,\s*(?:\{([^}]+)\}|(\w+)))?\s+from\s+)?['"](\.?[^'"]+)['"]/
  );
  if (match) {
    const names: string[] = [];
    // Named imports: { x, y }
    if (match[1]) {
      names.push(
        ...match[1].split(",").map((n) => n.trim().split(" as ")[0].trim())
      );
    }
    // Namespace import: * as z
    if (match[2]) {
      names.push(match[2].replace(/\*\s+as\s+/, "").trim());
    }
    // Default import: z
    if (match[3]) names.push(match[3]);
    // Additional named imports after default
    if (match[4]) {
      names.push(
        ...match[4].split(",").map((n) => n.trim().split(" as ")[0].trim())
      );
    }
    if (match[5]) names.push(match[5]);

    return { source: match[6], names };
  }
  return null;
}

/**
 * Resolve a relative import path to a file path.
 * Handles TypeScript ESM convention where imports use .js but files are .ts.
 */
function resolveImportPath(
  importSource: string,
  fromFile: string,
  projectFiles: Set<string>
): string | null {
  // Skip node_modules / external packages
  if (!importSource.startsWith(".") && !importSource.startsWith("/")) {
    return null;
  }

  const dir = path.dirname(fromFile);
  const basePath = path.resolve(dir, importSource);

  // TypeScript ESM convention: imports use .js but actual files are .ts
  // Strip .js/.jsx to try .ts/.tsx equivalents
  const withoutExt = basePath.replace(/\.(js|jsx)$/, "");
  const hasJsExt = /\.(js|jsx)$/.test(basePath);

  const candidates = [
    basePath,
    // TypeScript ESM: import from "./foo.js" → actual file is ./foo.ts
    ...(hasJsExt
      ? [
          withoutExt + ".ts",
          withoutExt + ".tsx",
        ]
      : []),
    // No extension provided — try adding
    basePath + ".ts",
    basePath + ".tsx",
    basePath + ".js",
    basePath + ".jsx",
    basePath + ".py",
    // Directory index
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.js"),
  ];

  for (const candidate of candidates) {
    if (projectFiles.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

// ─── Graph building ─────────────────────────────────────────────────────────

/**
 * Build the symbol dependency graph for a project directory.
 * Results are cached — subsequent calls with the same root return instantly.
 */
export function buildGraph(projectRoot: string): SymbolGraph {
  const resolvedRoot = path.resolve(projectRoot);

  // Return cached graph if same project root
  if (cachedGraph && cachedProjectRoot === resolvedRoot) {
    logger.info(`Graph cache hit for ${resolvedRoot} (${cachedGraph.nodes.size} nodes)`);
    return cachedGraph;
  }

  const startTime = Date.now();
  logger.info(`Building symbol graph for: ${resolvedRoot}`);

  const files = discoverFiles(resolvedRoot);
  const projectFiles = new Set(files);
  const nodes = new Map<string, SymbolNode>();
  const edges: SymbolEdge[] = [];
  const fileIndex = new Map<string, string[]>();

  // Phase 1: Extract symbols from each file
  for (const file of files) {
    const relFile = path.relative(resolvedRoot, file);
    const language = detectLanguage(file);
    const symbolNames: string[] = [];

    // Add module node
    const moduleKey = `mod:${relFile}`;
    nodes.set(moduleKey, { name: relFile, kind: "module", file: relFile });

    try {
      const source = fs.readFileSync(file, "utf-8");
      const sig = extractSignatures(source, language);

      // Functions
      for (const fn of sig.functions) {
        const fnName = extractSymbolName(fn, "function");
        if (fnName) {
          const key = `fn:${relFile}:${fnName}`;
          nodes.set(key, { name: fnName, kind: "function", file: relFile });
          edges.push({ from: moduleKey, to: key, kind: "contains" });
          symbolNames.push(key);
        }
      }

      // Classes
      for (const cls of sig.classes) {
        const clsName = extractSymbolName(cls, "class");
        if (clsName) {
          const key = `cls:${relFile}:${clsName}`;
          nodes.set(key, { name: clsName, kind: "class", file: relFile });
          edges.push({ from: moduleKey, to: key, kind: "contains" });
          symbolNames.push(key);
        }
      }

      // Imports → create edges to imported files
      for (const imp of sig.imports) {
        const parsed = parseImport(imp, language);
        if (parsed) {
          const resolvedPath = resolveImportPath(parsed.source, file, projectFiles);
          if (resolvedPath) {
            const targetRel = path.relative(resolvedRoot, resolvedPath);
            const targetModKey = `mod:${targetRel}`;
            edges.push({ from: moduleKey, to: targetModKey, kind: "imports" });

            // Link specific imported names
            for (const name of parsed.names) {
              const importKey = `imp:${relFile}:${name}`;
              nodes.set(importKey, {
                name: `${name} (from ${targetRel})`,
                kind: "import",
                file: relFile,
              });
              symbolNames.push(importKey);
            }
          }
        }
      }

      // Exports
      for (const exp of sig.exports) {
        const expName = extractSymbolName(exp, "export");
        if (expName) {
          const key = `exp:${relFile}:${expName}`;
          nodes.set(key, { name: expName, kind: "export", file: relFile });
          edges.push({ from: moduleKey, to: key, kind: "exports" });
          symbolNames.push(key);
        }
      }
    } catch (err) {
      logger.warn(`Failed to parse ${relFile}: ${err}`);
    }

    fileIndex.set(relFile, symbolNames);
  }

  const buildTimeMs = Date.now() - startTime;
  const graph: SymbolGraph = {
    nodes,
    edges,
    fileIndex,
    buildTimeMs,
    fileCount: files.length,
  };

  // Cache the result
  cachedGraph = graph;
  cachedProjectRoot = resolvedRoot;

  logger.info(
    `Graph built: ${nodes.size} nodes, ${edges.length} edges, ` +
      `${files.length} files in ${buildTimeMs}ms`
  );

  return graph;
}

/**
 * Invalidate the cached graph (e.g., after file changes).
 */
export function invalidateGraph(): void {
  cachedGraph = null;
  cachedProjectRoot = null;
  logger.info("Graph cache invalidated");
}

// ─── Symbol name extraction ─────────────────────────────────────────────────

function extractSymbolName(
  text: string,
  kind: "function" | "class" | "export"
): string | null {
  if (kind === "function") {
    // "function handleFoo(args: Type): ReturnType" → "handleFoo"
    // "def process(self, data)" → "process"
    const match = text.match(/(?:function|def|async\s+function)\s+(\w+)/);
    return match?.[1] ?? null;
  }
  if (kind === "class") {
    const match = text.match(/class\s+(\w+)/);
    return match?.[1] ?? null;
  }
  if (kind === "export") {
    // "export async function handleFoo" → "handleFoo"
    // "export const FOO" → "FOO"
    // "export default class" → "default"
    const fnMatch = text.match(/export\s+(?:async\s+)?function\s+(\w+)/);
    if (fnMatch) return fnMatch[1];
    const constMatch = text.match(/export\s+(?:const|let|var)\s+(\w+)/);
    if (constMatch) return constMatch[1];
    const classMatch = text.match(/export\s+(?:default\s+)?class\s+(\w+)/);
    if (classMatch) return classMatch[1];
    const defaultMatch = text.match(/export\s+default\s+(\w+)/);
    if (defaultMatch) return defaultMatch[1];
    return null;
  }
  return null;
}

// ─── Query engine ───────────────────────────────────────────────────────────

/**
 * BFS traversal from a starting node, returning all reachable nodes.
 */
function bfsTraverse(
  graph: SymbolGraph,
  startKeys: string[],
  maxDepth = 3,
  direction: "outgoing" | "incoming" = "outgoing"
): Map<string, number> {
  const visited = new Map<string, number>(); // key → depth
  const queue: Array<{ key: string; depth: number }> = [];

  for (const key of startKeys) {
    queue.push({ key, depth: 0 });
    visited.set(key, 0);
  }

  while (queue.length > 0) {
    const { key, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;

    // Find edges
    const connectedEdges = graph.edges.filter((e) =>
      direction === "outgoing" ? e.from === key : e.to === key
    );

    for (const edge of connectedEdges) {
      const nextKey = direction === "outgoing" ? edge.to : edge.from;
      if (!visited.has(nextKey)) {
        visited.set(nextKey, depth + 1);
        queue.push({ key: nextKey, depth: depth + 1 });
      }
    }
  }

  return visited;
}

/**
 * Find nodes matching a search query (fuzzy name match).
 */
function findNodes(graph: SymbolGraph, query: string): string[] {
  const lowerQuery = query.toLowerCase();
  const matches: string[] = [];

  for (const [key, node] of graph.nodes) {
    if (
      node.name.toLowerCase().includes(lowerQuery) ||
      key.toLowerCase().includes(lowerQuery)
    ) {
      matches.push(key);
    }
  }

  return matches;
}

/**
 * Format a graph traversal result into a compact token-efficient string.
 */
function formatTraversalResult(
  graph: SymbolGraph,
  visited: Map<string, number>,
  queryName: string,
  queryType: string
): string {
  const lines: string[] = [];
  lines.push(`// Gate-MCP Symbol Graph — ${queryType}: "${queryName}"`);
  lines.push(`// Nodes traversed: ${visited.size}`);
  lines.push("");

  // Group by depth
  const byDepth = new Map<number, string[]>();
  for (const [key, depth] of visited) {
    if (!byDepth.has(depth)) byDepth.set(depth, []);
    const node = graph.nodes.get(key);
    if (node) {
      byDepth.get(depth)!.push(`${node.kind}: ${node.name} (${node.file})`);
    }
  }

  for (const [depth, entries] of Array.from(byDepth.entries()).sort()) {
    const indent = "  ".repeat(depth);
    lines.push(`${indent}[depth ${depth}]`);
    for (const entry of entries.slice(0, 20)) {
      lines.push(`${indent}  → ${entry}`);
    }
    if (entries.length > 20) {
      lines.push(`${indent}  ... and ${entries.length - 20} more`);
    }
  }

  return lines.join("\n");
}

// ─── Public query API ───────────────────────────────────────────────────────

/**
 * Execute a graph query and return a token-efficient response.
 */
export function queryGraph(
  projectRoot: string,
  query: string,
  queryType: "depends_on" | "dependents" | "file_symbols" | "search" | "stats" = "search"
): GraphQueryResponse {
  const graph = buildGraph(projectRoot);

  // Estimate "what it would cost to read files raw"
  const avgTokensPerFile = 800;
  const naiveTokens = graph.fileCount * avgTokensPerFile;

  let result: string;
  let nodesTraversed: number;

  switch (queryType) {
    case "stats": {
      const moduleCount = Array.from(graph.nodes.values()).filter(
        (n) => n.kind === "module"
      ).length;
      const fnCount = Array.from(graph.nodes.values()).filter(
        (n) => n.kind === "function"
      ).length;
      const clsCount = Array.from(graph.nodes.values()).filter(
        (n) => n.kind === "class"
      ).length;
      const impEdges = graph.edges.filter((e) => e.kind === "imports").length;

      result = [
        `// Gate-MCP Symbol Graph Stats`,
        `// Built in ${graph.buildTimeMs}ms`,
        ``,
        `Files indexed: ${graph.fileCount}`,
        `Total nodes: ${graph.nodes.size}`,
        `  Modules: ${moduleCount}`,
        `  Functions: ${fnCount}`,
        `  Classes: ${clsCount}`,
        `Total edges: ${graph.edges.length}`,
        `  Import edges: ${impEdges}`,
        ``,
        `Estimated tokens saved per query: ~${naiveTokens} (raw) vs ~200 (graph)`,
      ].join("\n");
      nodesTraversed = graph.nodes.size;
      break;
    }

    case "file_symbols": {
      // Find all symbols in a specific file
      const matchingFiles = Array.from(graph.fileIndex.keys()).filter((f) =>
        f.toLowerCase().includes(query.toLowerCase())
      );
      if (matchingFiles.length === 0) {
        result = `No files matching "${query}" found in graph.`;
        nodesTraversed = 0;
      } else {
        const lines: string[] = [];
        for (const file of matchingFiles.slice(0, 5)) {
          lines.push(`// ${file}`);
          const symbols = graph.fileIndex.get(file) ?? [];
          for (const sym of symbols) {
            const node = graph.nodes.get(sym);
            if (node) lines.push(`  ${node.kind}: ${node.name}`);
          }
          lines.push("");
        }
        result = lines.join("\n");
        nodesTraversed = matchingFiles.reduce(
          (sum, f) => sum + (graph.fileIndex.get(f)?.length ?? 0),
          0
        );
      }
      break;
    }

    case "depends_on": {
      const startNodes = findNodes(graph, query);
      if (startNodes.length === 0) {
        result = `No symbols matching "${query}" found.`;
        nodesTraversed = 0;
      } else {
        const visited = bfsTraverse(graph, startNodes.slice(0, 3), 3, "outgoing");
        result = formatTraversalResult(graph, visited, query, "Dependencies of");
        nodesTraversed = visited.size;
      }
      break;
    }

    case "dependents": {
      const startNodes = findNodes(graph, query);
      if (startNodes.length === 0) {
        result = `No symbols matching "${query}" found.`;
        nodesTraversed = 0;
      } else {
        const visited = bfsTraverse(graph, startNodes.slice(0, 3), 3, "incoming");
        result = formatTraversalResult(graph, visited, query, "Dependents of");
        nodesTraversed = visited.size;
      }
      break;
    }

    case "search":
    default: {
      const matches = findNodes(graph, query);
      if (matches.length === 0) {
        result = `No symbols matching "${query}" found in ${graph.fileCount} files.`;
        nodesTraversed = 0;
      } else {
        const lines: string[] = [];
        lines.push(`// Search results for "${query}" (${matches.length} matches)`);
        lines.push("");
        for (const key of matches.slice(0, 25)) {
          const node = graph.nodes.get(key);
          if (node) {
            lines.push(`${node.kind}: ${node.name} — ${node.file}`);
          }
        }
        if (matches.length > 25) {
          lines.push(`... and ${matches.length - 25} more results`);
        }
        result = lines.join("\n");
        nodesTraversed = matches.length;
      }
      break;
    }
  }

  const optimizedTokens = countTextTokens(result);
  const savingsPercent =
    naiveTokens > 0
      ? Math.round(((naiveTokens - optimizedTokens) / naiveTokens) * 100)
      : 0;

  return {
    query,
    queryType,
    result,
    nodesTraversed,
    originalTokens: naiveTokens,
    optimizedTokens,
    savingsPercent,
  };
}
