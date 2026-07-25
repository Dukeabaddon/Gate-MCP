/**
 * Budgeted symbol map + HTML export for Gate's in-process symbol graph.
 * Complementary to graphifyy HTML — symbols/imports only.
 */

import fs from "node:fs";
import path from "node:path";
import type { SymbolGraph, SymbolEdge } from "./symbolGraph.js";
import { countTextTokens } from "./tokenCounter.js";
import { safeResolve } from "./pathGuard.js";

export interface SymbolMapOptions {
  tokenBudget?: number;
  query?: string;
}

export interface SymbolMapResult {
  text: string;
  nodesIncluded: number;
  edgesIncluded: number;
  tokenBudget: number;
  tokens: number;
}

function degreeMap(graph: SymbolGraph): Map<string, number> {
  const deg = new Map<string, number>();
  for (const key of graph.nodes.keys()) deg.set(key, 0);
  for (const e of graph.edges) {
    deg.set(e.from, (deg.get(e.from) ?? 0) + 1);
    deg.set(e.to, (deg.get(e.to) ?? 0) + 1);
  }
  return deg;
}

function queryBoost(key: string, query: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const node = key.toLowerCase();
  if (node.includes(q)) return 1000;
  return 0;
}

/**
 * Ranked symbol/file slice that fits a token budget (Aider-style map, Gate-owned).
 */
export function buildBudgetedSymbolMap(
  graph: SymbolGraph,
  opts: SymbolMapOptions = {}
): SymbolMapResult {
  const tokenBudget = Math.max(200, Math.min(opts.tokenBudget ?? 1200, 8000));
  const query = (opts.query ?? "").trim();
  const deg = degreeMap(graph);

  const ranked = [...graph.nodes.entries()]
    .map(([key, node]) => ({
      key,
      node,
      score: (deg.get(key) ?? 0) + queryBoost(key, query),
    }))
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));

  const lines: string[] = [
    `# Gate symbol map (${graph.fileCount} files, ${graph.nodes.size} nodes)`,
    query ? `# query boost: ${query}` : "# query boost: (none)",
    `# tokenBudget: ${tokenBudget}`,
    "",
  ];

  let tokens = countTextTokens(lines.join("\n"));
  const included = new Set<string>();
  let nodesIncluded = 0;

  for (const row of ranked) {
    const label =
      row.node.kind === "module"
        ? `file ${row.node.file}`
        : `${row.node.kind} ${row.node.name} @ ${row.node.file}`;
    const line = `- [${row.score}] ${label}`;
    const next = tokens + countTextTokens(line) + 1;
    if (next > tokenBudget) break;
    lines.push(line);
    included.add(row.key);
    nodesIncluded += 1;
    tokens = next;
  }

  if (nodesIncluded === 0 && ranked.length > 0) {
    // Guarantee at least one node when budget is tiny, then stop.
    const row = ranked[0];
    const label =
      row.node.kind === "module"
        ? `file ${row.node.file}`
        : `${row.node.kind} ${row.node.name} @ ${row.node.file}`;
    const line = `- [${row.score}] ${label}`;
    lines.push(line);
    included.add(row.key);
    nodesIncluded = 1;
    tokens = countTextTokens(lines.join("\n"));
  }

  const edgeHeader = ["", "## edges (among included)"];
  const edgeHeaderTokens = countTextTokens(edgeHeader.join("\n")) + 1;
  const edgeLines: string[] = [];
  let edgesIncluded = 0;
  let edgeTokens = tokens;
  if (tokens + edgeHeaderTokens <= tokenBudget) {
    edgeTokens = tokens + edgeHeaderTokens;
    for (const e of graph.edges) {
      if (!included.has(e.from) || !included.has(e.to)) continue;
      const line = `${e.from} -${e.kind}-> ${e.to}`;
      const next = edgeTokens + countTextTokens(line) + 1;
      if (next > tokenBudget) break;
      edgeLines.push(line);
      edgesIncluded += 1;
      edgeTokens = next;
    }
  }
  if (edgesIncluded > 0) {
    lines.push(...edgeHeader, ...edgeLines);
    tokens = edgeTokens;
  }

  const text = lines.join("\n");
  return {
    text,
    nodesIncluded,
    edgesIncluded,
    tokenBudget,
    tokens: countTextTokens(text),
  };
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** JSON safe for embedding inside a HTML <script> block. */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Write a self-contained HTML visualization of the symbol graph.
 * Caps nodes/edges for browser sanity on huge repos.
 */
export function writeSymbolGraphHtml(
  graph: SymbolGraph,
  outPath: string,
  opts: { maxNodes?: number; title?: string; projectRoot?: string } = {}
): { path: string; nodes: number; edges: number } {
  const maxNodes = opts.maxNodes ?? 400;
  const projectRoot = opts.projectRoot ?? path.dirname(path.dirname(outPath));
  const resolvedOut = safeResolve(outPath, {
    projectRoot,
    caller: "symbol-graph-html",
  });

  const deg = degreeMap(graph);
  const ranked = [...graph.nodes.entries()]
    .map(([key, node]) => ({ key, node, score: deg.get(key) ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxNodes);
  const keep = new Set(ranked.map((r) => r.key));
  const edges = graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to));

  const nodesJson = ranked.map((r, i) => {
    const angle = (2 * Math.PI * i) / Math.max(ranked.length, 1);
    const radius = 180 + (r.score % 17) * 12;
    return {
      id: r.key,
      label: r.node.kind === "module" ? r.node.file : r.node.name,
      kind: r.node.kind,
      file: r.node.file,
      x: 400 + radius * Math.cos(angle),
      y: 300 + radius * Math.sin(angle),
      score: r.score,
    };
  });

  const edgesJson = edges.map((e: SymbolEdge) => ({
    from: e.from,
    to: e.to,
    kind: e.kind,
  }));

  const title = opts.title ?? "Gate symbol graph";
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light; --bg:#f4f6f8; --ink:#1a1f24; --muted:#5c6b7a; --accent:#0b6e4f; }
  body { margin:0; font-family: "IBM Plex Sans", "Segoe UI", sans-serif; background:var(--bg); color:var(--ink); }
  header { padding:1rem 1.25rem; border-bottom:1px solid #d5dde5; background:#fff; }
  h1 { margin:0; font-size:1.15rem; letter-spacing:-0.02em; }
  p { margin:0.35rem 0 0; color:var(--muted); font-size:0.9rem; }
  #stage { width:100vw; height:calc(100vh - 72px); }
  svg { width:100%; height:100%; }
  .link { stroke:#9aa8b5; stroke-opacity:0.55; fill:none; }
  .node circle { stroke:#fff; stroke-width:1.5px; cursor:pointer; }
  .node text { font-size:10px; fill:var(--ink); pointer-events:none; }
  .kind-module circle { fill:var(--accent); }
  .kind-function circle { fill:#1d4e89; }
  .kind-class circle { fill:#8c2f39; }
  .kind-import circle, .kind-export circle { fill:#6b5b95; }
</style>
</head>
<body>
<header>
  <h1>${esc(title)}</h1>
  <p>${nodesJson.length} nodes / ${edgesJson.length} edges (capped). Gate symbol graph — not graphify HTML.</p>
</header>
<div id="stage"><svg id="viz"></svg></div>
<script>
const nodes = ${jsonForScript(nodesJson)};
const links = ${jsonForScript(edgesJson)};
const svg = document.getElementById('viz');
const W = svg.clientWidth || 800, H = svg.clientHeight || 600;
svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
for (const l of links) {
  const a = byId[l.from], b = byId[l.to];
  if (!a || !b) continue;
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('class', 'link');
  line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
  line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
  svg.appendChild(line);
}
for (const n of nodes) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('class', 'node kind-' + n.kind);
  g.setAttribute('transform', 'translate(' + n.x + ',' + n.y + ')');
  const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  c.setAttribute('r', String(4 + Math.min(10, n.score / 3)));
  const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
  t.textContent = n.label + ' (' + n.kind + ')\\n' + n.file;
  c.appendChild(t);
  const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  label.setAttribute('x', 8); label.setAttribute('y', 3);
  label.textContent = n.label.length > 28 ? n.label.slice(0, 26) + '…' : n.label;
  g.appendChild(c); g.appendChild(label); svg.appendChild(g);
}
</script>
</body>
</html>
`;

  fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
  fs.writeFileSync(resolvedOut, html, "utf8");
  return { path: resolvedOut, nodes: nodesJson.length, edges: edgesJson.length };
}
