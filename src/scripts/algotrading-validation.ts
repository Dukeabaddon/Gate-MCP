/**
 * AlgoTrading feedback regression — run after build:
 *   GATE_PROJECT_ROOT=/path/to/AlgoTrading node dist/scripts/algotrading-validation.js
 */

import fs from "node:fs";
import path from "node:path";
import { handleGateInit } from "../tools/gateInit.js";
import { handleCompressFile } from "../tools/compressFile.js";
import { handleGraphQuery } from "../tools/graphQuery.js";
import { handleSessionStats } from "../tools/sessionStats.js";
import { GATEMCP_VERSION } from "../version.js";

const ALGO_ROOT =
  process.env.GATE_PROJECT_ROOT ??
  "/Users/macbookair/Documents/Visual Studio Code/Python/AlgoTrading";
const SMC_ROOT = path.join(ALGO_ROOT, "crypto/strategies/active/smc");

const PASS = "✅";
const FAIL = "❌";

async function check(
  name: string,
  fn: () => Promise<void>
): Promise<boolean> {
  try {
    await fn();
    console.error(`  ${PASS} ${name}`);
    return true;
  } catch (e) {
    console.error(`  ${FAIL} ${name}: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

async function main(): Promise<void> {
  process.env.GATE_PROJECT_ROOT = ALGO_ROOT;

  console.error(`\nAlgoTrading validation (gatemcp v${GATEMCP_VERSION})`);
  console.error(`  ALGO_ROOT: ${ALGO_ROOT}`);
  console.error(`  SMC_ROOT:  ${SMC_ROOT}\n`);

  if (!fs.existsSync(ALGO_ROOT)) {
    console.error(`${FAIL} AlgoTrading root missing`);
    process.exit(1);
  }

  let ok = 0;
  let total = 0;

  total++;
  if (
    await check("gate_init finds nested graphify-out", async () => {
      const init = await handleGateInit({ projectRoot: ALGO_ROOT });
      if (!init.graphify.found) throw new Error("graphify not found from repo root");
      if (!init.graphify.reportPath?.includes("smc/graphify-out")) {
        throw new Error(`unexpected report: ${init.graphify.reportPath}`);
      }
      if (init.version !== GATEMCP_VERSION) throw new Error(`version ${init.version}`);
    })
  )
    ok++;

  total++;
  if (
    await check("gate_init SMC subroot", async () => {
      const init = await handleGateInit({ projectRoot: SMC_ROOT });
      if (!init.graphify.found) throw new Error("no graphify at SMC root");
    })
  )
    ok++;

  total++;
  if (
    await check("graphify_map real savings vs GRAPH_REPORT", async () => {
      const map = await handleGraphQuery({
        projectRoot: SMC_ROOT,
        query: "",
        queryType: "graphify_map",
      });
      if (map.originalTokens <= 0) throw new Error("originalTokens must be > 0");
      if (map.optimizedTokens >= map.originalTokens) {
        throw new Error("map should be smaller than full report");
      }
      if (map.savingsPercent <= 0) throw new Error("expected positive savingsPercent");
    })
  )
    ok++;

  total++;
  if (
    await check("symbol search order_manager", async () => {
      const r = await handleGraphQuery({
        projectRoot: SMC_ROOT,
        query: "order_manager",
        queryType: "search",
      });
      if (r.nodesTraversed === 0) throw new Error("expected symbol hits");
    })
  )
    ok++;

  total++;
  if (
    await check("graphify_search Community", async () => {
      const r = await handleGraphQuery({
        projectRoot: SMC_ROOT,
        query: "Community",
        queryType: "graphify_search",
      });
      if (!r.result.includes("Community")) throw new Error("no community hit");
    })
  )
    ok++;

  const orderManager = path.join(SMC_ROOT, "live/order_manager.py");
  total++;
  if (
    await check("compress order_manager.py signature", async () => {
      if (!fs.existsSync(orderManager)) throw new Error("file missing");
      const c = await handleCompressFile({
        filePath: orderManager,
        depth: "signature",
      });
      if (c.language !== "python") throw new Error(`lang ${c.language}`);
      if (c.savingsPercent < 50) {
        throw new Error(`low savings ${c.savingsPercent}%`);
      }
      if (c.expanded) throw new Error("should not expand");
      console.error(
        `       ${c.originalTokens} → ${c.optimizedTokens} (${c.savingsPercent}%)`
      );
    })
  )
    ok++;

  const settingsYaml = path.join(SMC_ROOT, "config/settings.yaml");
  total++;
  if (
    await check("compress settings.yaml no fake savings", async () => {
      if (!fs.existsSync(settingsYaml)) throw new Error("file missing");
      const c = await handleCompressFile({
        filePath: settingsYaml,
        depth: "signature",
      });
      if (c.savingsPercent > 0 && c.expanded) {
        throw new Error("must not report positive savings when expanded");
      }
      console.error(
        `       ${c.originalTokens} → ${c.optimizedTokens} expanded=${c.expanded} type=${c.type}`
      );
    })
  )
    ok++;

  total++;
  if (
    await check("gate_session_stats", async () => {
      const s = await handleSessionStats();
      if (s.version !== GATEMCP_VERSION) throw new Error(s.version);
    })
  )
    ok++;

  console.error(`\n${"═".repeat(50)}`);
  console.error(`  ${ok}/${total} checks passed`);
  console.error(`${"═".repeat(50)}\n`);

  process.exit(ok === total ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
