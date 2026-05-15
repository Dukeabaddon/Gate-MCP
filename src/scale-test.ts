/**
 * Gate-MCP Scale Test — FAIROS Experiment #1
 *
 * Tests the symbol graph against real-world repos:
 *   - Express.js (~141 JS files)
 *   - VSCode src/ (~6,115 TS files)
 *
 * Measures: build time, node/edge count, memory usage, query latency.
 */

import { handleGraphQuery } from "./tools/graphQuery.js";

const REPOS = [
  { name: "Gate-MCP (self)", root: process.cwd(), description: "14 TS files" },
  { name: "Express.js", root: "/tmp/express-scale-test", description: "~141 JS files" },
  { name: "VSCode (src/)", root: "/tmp/vscode-scale-test", description: "~6,115 TS files" },
];

async function runScaleTest(): Promise<void> {
  console.error("\n" + "═".repeat(60));
  console.error("  FAIROS Experiment #1 — Scale Test");
  console.error("═".repeat(60));

  for (const repo of REPOS) {
    console.error(`\n${"─".repeat(50)}`);
    console.error(`  📦 ${repo.name} (${repo.description})`);
    console.error("─".repeat(50));

    const memBefore = process.memoryUsage().heapUsed;
    const startTime = Date.now();

    try {
      // Force rebuild
      const statsResult = await handleGraphQuery({
        query: "stats",
        queryType: "stats",
        projectRoot: repo.root,
        rebuild: true,
      });

      const buildTime = Date.now() - startTime;
      const memAfter = process.memoryUsage().heapUsed;
      const memDelta = Math.round((memAfter - memBefore) / 1024 / 1024);

      console.error(`  ✅ Build time: ${buildTime}ms`);
      console.error(`  ✅ Nodes: ${statsResult.nodesTraversed}`);
      console.error(`  ✅ Tokens: ${statsResult.optimizedTokens}`);
      console.error(`  ✅ Memory delta: ~${memDelta}MB`);
      console.error(`  Result:\n${statsResult.note.slice(0, 400)}`);

      // Test a search query
      const searchStart = Date.now();
      const searchResult = await handleGraphQuery({
        query: "request",
        queryType: "search",
        projectRoot: repo.root,
      });
      const searchTime = Date.now() - searchStart;
      console.error(`\n  🔍 Search "request": ${searchTime}ms, ${searchResult.optimizedTokens} tokens`);

      // Test depends_on query on first file found
      const depsStart = Date.now();
      const depsResult = await handleGraphQuery({
        query: "index",
        queryType: "depends_on",
        projectRoot: repo.root,
      });
      const depsTime = Date.now() - depsStart;
      console.error(`  🔗 depends_on "index": ${depsTime}ms, ${depsResult.nodesTraversed} nodes, ${depsResult.optimizedTokens} tokens`);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ❌ FAILED: ${msg}`);
    }
  }

  // Final memory snapshot
  const mem = process.memoryUsage();
  console.error(`\n${"═".repeat(60)}`);
  console.error(`  Final Memory: heap=${Math.round(mem.heapUsed / 1024 / 1024)}MB, rss=${Math.round(mem.rss / 1024 / 1024)}MB`);
  console.error("═".repeat(60));
}

runScaleTest().catch((err) => {
  console.error(`Fatal: ${err}`);
  process.exit(1);
});
// Last reviewed: 2026-05-15 — verified against v0.3.2 fidelity test suite.
