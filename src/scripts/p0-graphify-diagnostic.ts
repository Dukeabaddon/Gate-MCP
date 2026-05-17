/**
 * P0 diagnostic: gate_graph_query vs graphify-out (nested repo layout).
 * Run: npm run build && node dist/scripts/p0-graphify-diagnostic.js [projectRoot]
 */

import fs from "node:fs";
import path from "node:path";
import { handleGraphQuery } from "../tools/graphQuery.js";
import { invalidateGraph } from "../lib/symbolGraph.js";

const ALGO_ROOT =
  "/Users/macbookair/Documents/Visual Studio Code/Python/AlgoTrading";
const SMC_ROOT = path.join(ALGO_ROOT, "crypto/strategies/active/smc");
const GRAPHIFY_REPORT = path.join(SMC_ROOT, "graphify-out/GRAPH_REPORT.md");

const roots = process.argv[2]
  ? [path.resolve(process.argv[2])]
  : [ALGO_ROOT, SMC_ROOT, process.cwd()];

const searches = [
  "order_manager",
  "signal_policy",
  "strategy_adapter",
  "ws_client",
  "Community",
  "smc",
];

async function runRoot(root: string): Promise<void> {
  console.error(`\n${"═".repeat(60)}\nROOT: ${root}\n${"═".repeat(60)}`);
  const graphifyHere = [
    path.join(root, "graphify-out/GRAPH_REPORT.md"),
    path.join(root, "crypto/strategies/active/smc/graphify-out/GRAPH_REPORT.md"),
  ];
  for (const p of graphifyHere) {
    console.error(`  graphify: ${p} → ${fs.existsSync(p) ? "YES" : "no"}`);
  }

  invalidateGraph();
  const stats = await handleGraphQuery({
    projectRoot: root,
    query: "stats",
    queryType: "stats",
    rebuild: true,
  });
  console.error(`\n  STATS nodesTraversed=${stats.nodesTraversed} graphify=${stats.graphifyReport ?? "none"}`);
  console.error(stats.result.split("\n").slice(0, 8).join("\n"));

  for (const q of searches) {
    const r = await handleGraphQuery({
      projectRoot: root,
      query: q,
      queryType: "search",
    });
    console.error(`  search "${q}" → ${r.nodesTraversed} hits source=${r.source}`);
  }

  const g = await handleGraphQuery({
    projectRoot: root,
    query: "OrderManager",
    queryType: "graphify_search",
  });
  console.error(`  graphify_search OrderManager → ${g.result.includes("OrderManager") ? "YES" : "no"}`);
}

async function main(): Promise<void> {
  console.error("P0 graphify / gate_graph diagnostic");
  console.error(`Global graphify report: ${GRAPHIFY_REPORT}`);
  console.error(`  exists: ${fs.existsSync(GRAPHIFY_REPORT)}`);
  if (fs.existsSync(GRAPHIFY_REPORT)) {
    const head = fs.readFileSync(GRAPHIFY_REPORT, "utf8").split("\n").slice(0, 6);
    console.error(head.join("\n"));
  }
  for (const root of roots) {
    if (fs.existsSync(root)) await runRoot(root);
    else console.error(`SKIP missing root: ${root}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
