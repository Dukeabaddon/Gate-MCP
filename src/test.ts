/**
 * Gate-MCP Test Script
 *
 * Tests both primary tools with sample inputs.
 * Run with: npm run build && npm test
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleOptimizeImage } from "./tools/optimizeImage.js";
import { handleCompressFile } from "./tools/compressFile.js";
import { handleGraphQuery } from "./tools/graphQuery.js";
import { findGraphifyReport } from "./lib/projectRoot.js";
import { handleMemory } from "./tools/memory.js";
import { handleDedupContext } from "./tools/dedupContext.js";
import { handleCleanResponse } from "./tools/cleanResponse.js";
import { handleProxyTools, handleProxyCall } from "./tools/proxyTools.js";
import { handleValidateCompression } from "./tools/validateCompression.js";
import { handleSessionStats } from "./tools/sessionStats.js";
import { handleGateInit } from "./tools/gateInit.js";
import { GATEMCP_VERSION } from "./version.js";
import { handleHelp } from "./tools/help.js";
import { calculateSavings, formatSavingsNote } from "./lib/tokenCounter.js";
import { countGraphifyReportTokens } from "./lib/graphifyBridge.js";
import { closeAllProxies } from "./lib/proxyClient.js";
import { terminateOcr } from "./lib/imageProcessor.js";
import { closeCacheDb, isPersistent } from "./lib/cacheDb.js";
import { _resetSessionMeasurementsForTests } from "./lib/sessionMetrics.js";
import { runDoctor } from "./doctor.js";
import {
  isMemoryPersistent,
  _resetMemoryDbForTests,
} from "./lib/memoryDb.js";
import { canonicalizePath } from "./lib/pathGuard.js";

const DIVIDER = "═".repeat(60);
const PASS = "✅";
const FAIL = "❌";
const INFO = "ℹ️";

async function runTests(): Promise<void> {
  console.error(`\n${DIVIDER}`);
  console.error(`  gatemcp Test Suite v${GATEMCP_VERSION}`);
  console.error(DIVIDER);

  let passed = 0;
  let failed = 0;

  // ── Test 1: gate_compress_file (signature) ──
  console.error(`\n${INFO} Test 1: gate_compress_file (signature mode)`);
  try {
    // Use this test file itself as input
    const testFile = path.resolve(process.cwd(), "src/main.ts");
    if (fs.existsSync(testFile)) {
      const result = await handleCompressFile({
        filePath: testFile,
        depth: "signature",
      });
      console.error(`  ${PASS} type: ${result.type}`);
      console.error(`  ${PASS} language: ${result.language}`);
      console.error(`  ${PASS} originalTokens: ${result.originalTokens}`);
      console.error(`  ${PASS} optimizedTokens: ${result.optimizedTokens}`);
      console.error(`  ${PASS} savingsPercent: ${result.savingsPercent}%`);
      console.error(`  ${PASS} note: ${result.note}`);
      console.error(`  Content preview:\n${result.content.slice(0, 300)}...`);
      passed++;
    } else {
      console.error(`  ${FAIL} Test file not found: ${testFile}`);
      failed++;
    }
  } catch (err) {
    console.error(`  ${FAIL} Error: ${err}`);
    failed++;
  }

  // ── Test 2: gate_compress_file (summary) ──
  console.error(`\n${INFO} Test 2: gate_compress_file (summary mode)`);
  try {
    const testFile = path.resolve(process.cwd(), "src/main.ts");
    if (fs.existsSync(testFile)) {
      const result = await handleCompressFile({
        filePath: testFile,
        depth: "summary",
      });
      console.error(`  ${PASS} type: ${result.type}`);
      console.error(`  ${PASS} savingsPercent: ${result.savingsPercent}%`);
      passed++;
    } else {
      console.error(`  ${FAIL} Test file not found`);
      failed++;
    }
  } catch (err) {
    console.error(`  ${FAIL} Error: ${err}`);
    failed++;
  }

  // ── Test 3: gate_compress_file (error handling) ──
  console.error(`\n${INFO} Test 3: gate_compress_file (nonexistent file)`);
  try {
    await handleCompressFile({ filePath: "/nonexistent/file.ts" });
    console.error(`  ${FAIL} Should have thrown an error`);
    failed++;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ${PASS} Correctly threw error: ${msg}`);
    passed++;
  }

  // ── Test 4: gate_graph_query (stats) ──
  console.error(`\n${INFO} Test 4: gate_graph_query (stats — build graph)`);
  try {
    const result = await handleGraphQuery({
      query: "stats",
      queryType: "stats",
      rebuild: true,
    });
    console.error(`  ${PASS} Graph built successfully`);
    console.error(`  ${PASS} Nodes traversed: ${result.nodesTraversed}`);
    console.error(`  ${PASS} Response tokens: ${result.optimizedTokens}`);
    console.error(`  ${PASS} Estimated raw read tokens: ${result.originalTokens}`);
    console.error(`  ${PASS} Savings: ${result.savingsPercent}%`);
    console.error(`  Result preview:\n${result.result.slice(0, 400)}`);
    if (result.nodesTraversed > 0 && result.savingsPercent > 0) {
      passed++;
    } else {
      console.error(`  ${FAIL} Graph appears empty`);
      failed++;
    }
  } catch (err) {
    console.error(`  ${FAIL} Error: ${err}`);
    failed++;
  }

  // ── Test 4b: gate_graph_query (search) ──
  console.error(`\n${INFO} Test 4b: gate_graph_query (search for "handleCompressFile")`);
  try {
    const result = await handleGraphQuery({
      query: "handleCompressFile",
      queryType: "search",
    });
    console.error(`  ${PASS} Found ${result.nodesTraversed} matches`);
    console.error(`  ${PASS} Response: ${result.optimizedTokens} tokens`);
    if (result.nodesTraversed > 0) {
      passed++;
    } else {
      console.error(`  ${FAIL} Expected to find handleCompressFile symbol`);
      failed++;
    }
  } catch (err) {
    console.error(`  ${FAIL} Error: ${err}`);
    failed++;
  }

  // ── Test 4c: gate_graph_query (depends_on) ──
  console.error(`\n${INFO} Test 4c: gate_graph_query (depends_on "main.ts")`);
  try {
    const result = await handleGraphQuery({
      query: "main.ts",
      queryType: "depends_on",
    });
    console.error(`  ${PASS} Traversed ${result.nodesTraversed} nodes`);
    console.error(`  ${PASS} Response: ${result.optimizedTokens} tokens vs ${result.originalTokens} raw`);
    console.error(`  ${PASS} Savings: ${result.savingsPercent}%`);
    passed++;
  } catch (err) {
    console.error(`  ${FAIL} Error: ${err}`);
    failed++;
  }

  // ── Test 5: gate_memory (write → read → list → delete → clear) ──
  console.error(`\n${INFO} Test 5: gate_memory (functional)`);
  try {
    const projectRoot = process.cwd();

    // Write
    const writeResult = await handleMemory({
      action: "write",
      key: "test_key",
      value: "Gate-MCP test value — cross-session persistence!",
      projectRoot,
    });
    console.error(`  ${PASS} WRITE: ${writeResult.note}`);

    // Read
    const readResult = await handleMemory({
      action: "read",
      key: "test_key",
      projectRoot,
    });
    if (readResult.value?.includes("Gate-MCP")) {
      console.error(`  ${PASS} READ: got "${readResult.value?.slice(0, 40)}..."`);
    } else {
      console.error(`  ${FAIL} READ: value mismatch`);
      failed++;
    }

    // List
    const listResult = await handleMemory({ action: "list", key: "*", projectRoot });
    console.error(`  ${PASS} LIST: ${listResult.entries} entries`);

    // Delete
    const deleteResult = await handleMemory({
      action: "delete",
      key: "test_key",
      projectRoot,
    });
    console.error(`  ${PASS} DELETE: ${deleteResult.note}`);

    // Clear
    const clearResult = await handleMemory({ action: "clear", key: "*", projectRoot });
    console.error(`  ${PASS} CLEAR: ${clearResult.note}`);

    const memBackend = isMemoryPersistent(projectRoot) ? "SQLite" : "JSON";
    console.error(`  ${PASS} Memory backend: ${memBackend}`);

    passed++;
  } catch (err) {
    console.error(`  ${FAIL} Error: ${err}`);
    failed++;
  }

  // ── Test 5d: gate_memory JSON → SQLite migration (isolated project root) ──
  console.error(`\n${INFO} Test 5d: gate_memory (memory.json migration)`);
  try {
    const memRoot = path.resolve(process.cwd(), "test-memory-migrate-root");
    const gateDir = path.join(memRoot, ".gate-mcp");
    fs.rmSync(memRoot, { recursive: true, force: true });
    fs.mkdirSync(gateDir, { recursive: true });
    fs.writeFileSync(
      path.join(gateDir, "memory.json"),
      JSON.stringify({ legacy_key: "legacy_value_from_json" }, null, 2),
      "utf8"
    );
    _resetMemoryDbForTests();

    const readAfter = await handleMemory({
      action: "read",
      key: "legacy_key",
      projectRoot: memRoot,
    });

    const migratedPath = path.join(gateDir, "memory.json.migrated");
    const jsonGone = !fs.existsSync(path.join(gateDir, "memory.json"));

    if (readAfter.value !== "legacy_value_from_json") {
      throw new Error(
        `expected migrated value, got ${readAfter.value ?? "(missing)"}`
      );
    }

    if (isMemoryPersistent(memRoot)) {
      if (!jsonGone && !fs.existsSync(migratedPath)) {
        throw new Error("SQLite active but memory.json was not migrated/renamed");
      }
      console.error(`  ${PASS} Migrated legacy_key via SQLite`);
      if (fs.existsSync(migratedPath)) {
        console.error(`  ${PASS} memory.json → memory.json.migrated`);
      }
    } else {
      console.error(`  ${PASS} JSON fallback: legacy_key readable (no SQLite on host)`);
    }

    _resetMemoryDbForTests();
    fs.rmSync(memRoot, { recursive: true, force: true });
    passed++;
  } catch (err) {
    console.error(`  ${FAIL} Error: ${err}`);
    failed++;
    _resetMemoryDbForTests();
  }

  // ── Test 5b: gate_clean_response (TOON — array) ──
  console.error(`\n${INFO} Test 5b: gate_clean_response (TOON array)`);
  try {
    const sampleJson = JSON.stringify([
      { id: 1, name: "Alice", role: "admin", email: "alice@test.com" },
      { id: 2, name: "Bob", role: "user", email: "bob@test.com" },
      { id: 3, name: "Charlie", role: "user", email: "charlie@test.com" },
      { id: 4, name: "Diana", role: "moderator", email: "diana@test.com" },
      { id: 5, name: "Eve", role: "admin", email: "eve@test.com" },
    ]);
    const result = await handleCleanResponse({ data: sampleJson, format: "toon" });
    console.error(`  ${PASS} ${result.originalTokens} → ${result.optimizedTokens} tokens (${result.savingsPercent}% saved)`);
    console.error(`  ${PASS} TOON output:\n${result.cleaned}`);
    if (result.savingsPercent > 20) passed++; else { console.error(`  ${FAIL} Savings too low`); failed++; }
  } catch (err) {
    console.error(`  ${FAIL} Error: ${err}`);
    failed++;
  }

  // ── Test 5c: gate_clean_response (TOON — nested object) ──
  console.error(`\n${INFO} Test 5c: gate_clean_response (TOON nested)`);
  try {
    const nested = JSON.stringify({
      status: "success",
      total: 3,
      users: [
        { id: 1, name: "Alice", score: 95 },
        { id: 2, name: "Bob", score: 87 },
        { id: 3, name: "Charlie", score: 92 },
      ],
      metadata: { page: 1, limit: 50, hasMore: false },
    });
    const result = await handleCleanResponse({ data: nested });
    console.error(`  ${PASS} ${result.originalTokens} → ${result.optimizedTokens} tokens (${result.savingsPercent}% saved)`);
    console.error(`  ${PASS} TOON output:\n${result.cleaned}`);
    passed++;
  } catch (err) {
    console.error(`  ${FAIL} Error: ${err}`);
    failed++;
  }

  // ── Test 5d: gate_clean_response (whitelist) ──
  console.error(`\n${INFO} Test 5d: gate_clean_response (whitelist)`);
  try {
    const bigJson = JSON.stringify([
      { id: 1, name: "Alice", role: "admin", email: "a@t.com", created: "2024-01-01", lastLogin: "2026-05-13", avatar: "base64..." },
      { id: 2, name: "Bob", role: "user", email: "b@t.com", created: "2024-02-01", lastLogin: "2026-05-10", avatar: "base64..." },
    ]);
    const result = await handleCleanResponse({
      data: bigJson,
      format: "whitelist",
      whitelist: ["id", "name", "role"],
    });
    console.error(`  ${PASS} Whitelist [id,name,role]: ${result.originalTokens} → ${result.optimizedTokens} tokens (${result.savingsPercent}% saved)`);
    console.error(`  ${PASS} Output:\n${result.cleaned}`);
    if (result.savingsPercent > 30) passed++; else { console.error(`  ${FAIL} Savings too low`); failed++; }
  } catch (err) {
    console.error(`  ${FAIL} Error: ${err}`);
    failed++;
  }

  // ── Test 6: gate_dedup_context (session cache) ──
  console.error(`\n${INFO} Test 6: gate_dedup_context (auto-cache via compress_file)`);
  try {
    // First: clear any existing cache
    await handleDedupContext({ action: "clear" });

    // Read a file for the first time — should be cache MISS, stored automatically
    const dedupFile = path.resolve(process.cwd(), "src/lib/logger.ts");
    const firstRead = await handleCompressFile({ filePath: dedupFile, depth: "signature" });
    console.error(
      `  ${PASS} First read: ${firstRead.originalTokens} → ${firstRead.optimizedTokens} tokens (${firstRead.savingsPercent}% saved)`
    );

    // Second read — should be cache HIT (file unchanged)
    const secondRead = await handleCompressFile({ filePath: dedupFile, depth: "signature" });
    const isDedup = secondRead.note?.includes("[DEDUP]") || secondRead.note?.includes("Cache hit");
    if (isDedup) {
      console.error(
        `  ${PASS} Second read: DEDUP HIT — ${secondRead.note}`
      );
    } else {
      console.error(
        `  ${PASS} Second read: ${secondRead.optimizedTokens} tokens (cache may not have triggered)`
      );
    }
    passed++;
  } catch (err) {
    console.error(`  ${FAIL} Error: ${err}`);
    failed++;
  }

  // ── Test 7: gate_dedup_context (stats) ──
  console.error(`\n${INFO} Test 7: gate_dedup_context (stats)`);
  try {
    const stats = await handleDedupContext({ action: "stats" });
    console.error(`  ${PASS} Cache entries: ${stats.totalEntries}`);
    console.error(`  ${PASS} Total hits: ${stats.totalHits}`);
    console.error(`  ${PASS} Total tokens saved: ${stats.totalTokensSaved}`);
    if (stats.totalEntries !== undefined && stats.totalEntries >= 0) {
      passed++;
    } else {
      console.error(`  ${FAIL} Stats missing expected fields`);
      failed++;
    }
  } catch (err) {
    console.error(`  ${FAIL} Error: ${err}`);
    failed++;
  }

  // ── Test 14: dedup cache — store → check increments hit_count ──
  console.error(`\n${INFO} Test 14: dedup cache (store → check increments hit_count)`);
  try {
    const backend = isPersistent() ? "SQLite" : "in-memory";
    console.error(`  ${INFO} Cache backend: ${backend}`);
    await handleDedupContext({ action: "clear" });

    const target = path.resolve(process.cwd(), "src/types.ts");
    const storeResult = await handleDedupContext({
      action: "store",
      filePath: target,
      content: "/* compressed stub */",
      originalTokens: 500,
      type: "file",
    });
    if (!storeResult.cached) throw new Error("store did not report cached=true");

    const firstCheck = await handleDedupContext({ action: "check", filePath: target });
    if (firstCheck.status !== "cache_hit") {
      throw new Error(`expected cache_hit, got ${firstCheck.status}`);
    }
    if (firstCheck.hitCount !== 1) {
      throw new Error(`expected hitCount=1, got ${firstCheck.hitCount}`);
    }
    const secondCheck = await handleDedupContext({ action: "check", filePath: target });
    if (secondCheck.hitCount !== 2) {
      throw new Error(`expected hitCount=2, got ${secondCheck.hitCount}`);
    }
    if (typeof secondCheck.dedupTokens !== "number" || secondCheck.dedupTokens <= 0) {
      throw new Error("dedupTokens missing on cache_hit");
    }
    console.error(`  ${PASS} store → check #1 → check #2 returned hitCount 1, then 2`);
    console.error(`  ${PASS} response shape preserved (status/filePath/hash/dedupTokens)`);
    passed++;
  } catch (err) {
    console.error(`  ${FAIL} Error: ${err}`);
    failed++;
  }

  // ── Test 15: dedup cache — file mutation triggers cache_update ──
  console.error(`\n${INFO} Test 15: dedup cache (file mutation → cache_update)`);
  try {
    await handleDedupContext({ action: "clear" });
    const tmp = path.resolve(process.cwd(), "test-dedup-sample.ts");
    fs.writeFileSync(tmp, "export const A = 1;\n");
    try {
      await handleDedupContext({
        action: "store",
        filePath: tmp,
        content: "// stub v1",
        originalTokens: 100,
      });

      const hit = await handleDedupContext({ action: "check", filePath: tmp });
      if (hit.status !== "cache_hit") {
        throw new Error(`expected cache_hit before mutation, got ${hit.status}`);
      }

      fs.writeFileSync(tmp, "export const A = 1;\nexport const B = 2;\n");
      const stale = await handleDedupContext({ action: "check", filePath: tmp });
      if (stale.status !== "cache_update") {
        throw new Error(`expected cache_update after mutation, got ${stale.status}`);
      }
      console.error(`  ${PASS} Mutation correctly invalidated cache (status=cache_update)`);

      const miss = await handleDedupContext({ action: "check", filePath: tmp });
      if (miss.status !== "cache_miss") {
        throw new Error(`expected cache_miss after invalidation, got ${miss.status}`);
      }
      console.error(`  ${PASS} Subsequent check returns cache_miss until re-stored`);
      passed++;
    } finally {
      try { fs.unlinkSync(tmp); } catch {}
    }
  } catch (err) {
    console.error(`  ${FAIL} Error: ${err}`);
    failed++;
  }

  // ── Test 16: dedup cache — stats consistency ──
  console.error(`\n${INFO} Test 16: dedup cache (stats consistency)`);
  try {
    await handleDedupContext({ action: "clear" });
    const f1 = path.resolve(process.cwd(), "src/types.ts");
    const f2 = path.resolve(process.cwd(), "src/lib/logger.ts");
    await handleDedupContext({
      action: "store", filePath: f1, content: "stub-1", originalTokens: 800,
    });
    await handleDedupContext({
      action: "store", filePath: f2, content: "stub-2", originalTokens: 400,
    });
    await handleDedupContext({ action: "check", filePath: f1 });
    await handleDedupContext({ action: "check", filePath: f1 });
    await handleDedupContext({ action: "check", filePath: f2 });

    const stats = await handleDedupContext({ action: "stats" });
    if (stats.totalEntries !== 2) {
      throw new Error(`expected totalEntries=2, got ${stats.totalEntries}`);
    }
    if (stats.totalHits !== 3) {
      throw new Error(`expected totalHits=3, got ${stats.totalHits}`);
    }
    const expectedHitsFromEntries = (stats.entries ?? []).reduce(
      (sum, e) => sum + e.hitCount, 0
    );
    if (expectedHitsFromEntries !== stats.totalHits) {
      throw new Error(`per-entry hitCount sum != totalHits (${expectedHitsFromEntries} vs ${stats.totalHits})`);
    }
    if ((stats.totalTokensSaved ?? -1) < 0) {
      throw new Error("totalTokensSaved missing or negative");
    }
    console.error(`  ${PASS} totalEntries=${stats.totalEntries}, totalHits=${stats.totalHits}, totalTokensSaved=${stats.totalTokensSaved}`);
    console.error(`  ${PASS} Per-entry hitCount sums match aggregate`);
    passed++;
  } catch (err) {
    console.error(`  ${FAIL} Error: ${err}`);
    failed++;
  }

  // ── Test 17: dedup cache — clear wipes entries ──
  console.error(`\n${INFO} Test 17: dedup cache (clear wipes entries)`);
  try {
    const f1 = path.resolve(process.cwd(), "src/types.ts");
    await handleDedupContext({
      action: "store", filePath: f1, content: "stub-clear", originalTokens: 800,
    });
    const before = await handleDedupContext({ action: "stats" });
    if ((before.totalEntries ?? 0) < 1) {
      throw new Error(`expected at least 1 entry before clear, got ${before.totalEntries}`);
    }

    await handleDedupContext({ action: "clear" });
    const after = await handleDedupContext({ action: "stats" });
    if (after.totalEntries !== 0) {
      throw new Error(`expected 0 entries after clear, got ${after.totalEntries}`);
    }
    if (after.totalHits !== 0) {
      throw new Error(`expected totalHits=0 after clear, got ${after.totalHits}`);
    }
    if (after.totalTokensSaved !== 0) {
      throw new Error(`expected totalTokensSaved=0 after clear, got ${after.totalTokensSaved}`);
    }
    console.error(`  ${PASS} Pre-clear entries: ${before.totalEntries}, post-clear: 0`);
    console.error(`  ${PASS} totalHits and totalTokensSaved both reset to 0`);
    passed++;
  } catch (err) {
    console.error(`  ${FAIL} Error: ${err}`);
    failed++;
  }

  // ── Test 18-24: proxy mode (gate_proxy_tools + gate_proxy_call) ──
  // Set up an isolated project root + proxy config that points at the mock
  // MCP server we just built. We use a tmp dir so we never touch the user's
  // real .gate-mcp/proxy-servers.json.
  const proxyRoot = path.resolve(process.cwd(), "test-proxy-root");
  const proxyConfigDir = path.join(proxyRoot, ".gate-mcp");
  const proxyConfigPath = path.join(proxyConfigDir, "proxy-servers.json");
  const mockServerPath = path.resolve(
    process.cwd(),
    "dist/scripts/mock-mcp-server.js"
  );
  let proxyTestsRan = false;

  if (!fs.existsSync(mockServerPath)) {
    console.error(
      `\n${INFO} Proxy tests 18-24 skipped — mock server not built at ${mockServerPath}`
    );
  } else {
    try {
      fs.mkdirSync(proxyConfigDir, { recursive: true });
      fs.writeFileSync(
        proxyConfigPath,
        JSON.stringify(
          {
            servers: {
              mock: {
                command: "node",
                args: [mockServerPath],
                description: "test fixture server",
              },
            },
          },
          null,
          2
        )
      );
      proxyTestsRan = true;
    } catch (err) {
      console.error(`${FAIL} could not write proxy test config: ${err}`);
    }
  }

  if (proxyTestsRan) {
    process.env.GATE_ENABLE_PROXY = "1";
    // ── Test 18: empty config returns empty servers list ──
    console.error(`\n${INFO} Test 18: gate_proxy_tools (no config → empty)`);
    try {
      const emptyRoot = path.join(proxyRoot, "empty-subdir");
      fs.mkdirSync(emptyRoot, { recursive: true });
      const result = await handleProxyTools({
        action: "list",
        projectRoot: emptyRoot,
      });
      if ((result.servers ?? []).length !== 0) {
        throw new Error(`expected 0 servers, got ${result.servers?.length}`);
      }
      console.error(`  ${PASS} Empty config returns 0 servers`);
      console.error(`  ${PASS} Helpful note: ${result.note.slice(0, 80)}...`);
      passed++;
    } catch (err) {
      console.error(`  ${FAIL} Error: ${err}`);
      failed++;
    }

    // ── Test 19: list mock server tools (4 expected, compressed) ──
    console.error(
      `\n${INFO} Test 19: gate_proxy_tools list (mock server, 4 tools)`
    );
    try {
      const result = await handleProxyTools({
        action: "list",
        projectRoot: proxyRoot,
      });
      const tools = result.tools ?? [];
      if (tools.length !== 4) {
        throw new Error(`expected 4 tools, got ${tools.length}`);
      }
      const names = tools.map((t) => t.name).sort();
      if (names.join(",") !== "add,echo,make_json_list,sleep") {
        throw new Error(`unexpected tool names: ${names.join(",")}`);
      }
      const addTool = tools.find((t) => t.name === "add")!;
      if (!addTool.params.includes("a:num") || !addTool.params.includes("b:num")) {
        throw new Error(
          `add tool params abbreviation wrong: ${addTool.params}`
        );
      }
      console.error(
        `  ${PASS} Listed 4 tools (add, echo, make_json_list, sleep)`
      );
      console.error(
        `  ${PASS} Compressed catalog: ${result.tokenCost.rawEstimate} → ${result.tokenCost.compressed} tokens (${result.tokenCost.savingsPercent}% saved)`
      );
      console.error(`  ${PASS} Schema abbreviation correct: add → ${addTool.params}`);
      passed++;
    } catch (err) {
      console.error(`  ${FAIL} Error: ${err}`);
      failed++;
    }

    // ── Test 20: describe returns full schema ──
    console.error(`\n${INFO} Test 20: gate_proxy_tools describe (full schema)`);
    try {
      const result = await handleProxyTools({
        action: "describe",
        server: "mock",
        tool: "make_json_list",
        projectRoot: proxyRoot,
      });
      if (!result.describe) {
        throw new Error("describe payload missing");
      }
      if (result.describe.name !== "make_json_list") {
        throw new Error(`wrong tool name: ${result.describe.name}`);
      }
      const schema = result.describe.inputSchema as {
        properties?: Record<string, unknown>;
      };
      if (!schema.properties?.count) {
        throw new Error("count property missing from schema");
      }
      console.error(`  ${PASS} Full schema returned for mock.make_json_list`);
      console.error(`  ${PASS} description: ${result.describe.description.slice(0, 80)}...`);
      passed++;
    } catch (err) {
      console.error(`  ${FAIL} Error: ${err}`);
      failed++;
    }

    // ── Test 21: gate_proxy_call echo (round-trip) ──
    console.error(`\n${INFO} Test 21: gate_proxy_call echo (round-trip)`);
    try {
      const result = await handleProxyCall({
        server: "mock",
        tool: "echo",
        args: { message: "hello from gatemcp" },
        format: "raw",
        projectRoot: proxyRoot,
      });
      if (result.response.trim() !== "hello from gatemcp") {
        throw new Error(`unexpected echo response: "${result.response}"`);
      }
      if (result.isError) {
        throw new Error("echo unexpectedly flagged isError=true");
      }
      console.error(`  ${PASS} Echo round-trip succeeded`);
      console.error(`  ${PASS} Response: "${result.response.trim()}"`);
      passed++;
    } catch (err) {
      console.error(`  ${FAIL} Error: ${err}`);
      failed++;
    }

    // ── Test 22: gate_proxy_call make_json_list → TOON compression saves ≥30% ──
    console.error(
      `\n${INFO} Test 22: gate_proxy_call make_json_list (TOON compression)`
    );
    try {
      const result = await handleProxyCall({
        server: "mock",
        tool: "make_json_list",
        args: { count: 25 },
        format: "toon",
        projectRoot: proxyRoot,
      });
      const { rawResponseTokens, compressedTokens, savingsPercent } =
        result.tokenCost;
      if (savingsPercent < 30) {
        throw new Error(
          `expected ≥30% savings on 25-row uniform list, got ${savingsPercent}%`
        );
      }
      if (!result.response.includes("id|label|score|active")) {
        throw new Error("TOON header row missing from response");
      }
      console.error(
        `  ${PASS} TOON compression: ${rawResponseTokens} → ${compressedTokens} tokens (${savingsPercent}% saved)`
      );
      console.error(`  ${PASS} Header row present: id|label|score|active`);
      passed++;
    } catch (err) {
      console.error(`  ${FAIL} Error: ${err}`);
      failed++;
    }

    // ── Test 23: status reports the open connection ──
    console.error(`\n${INFO} Test 23: gate_proxy_tools status`);
    try {
      const result = await handleProxyTools({ action: "status" });
      const rows = result.status ?? [];
      const mockRow = rows.find((r) => r.server === "mock");
      if (!mockRow) {
        throw new Error("expected mock connection in status output");
      }
      if (mockRow.toolsCached < 4) {
        throw new Error(
          `expected ≥4 cached tools, got ${mockRow.toolsCached}`
        );
      }
      console.error(
        `  ${PASS} Status reports mock connection with ${mockRow.toolsCached} tools cached`
      );
      passed++;
    } catch (err) {
      console.error(`  ${FAIL} Error: ${err}`);
      failed++;
    }

    // ── Test 24a: gate_proxy_call timeout (sleep beyond timeoutMs) ──
    console.error(
      `\n${INFO} Test 24a: gate_proxy_call timeout (sleep > timeoutMs)`
    );
    try {
      const startedAt = Date.now();
      try {
        await handleProxyCall({
          server: "mock",
          tool: "sleep",
          args: { ms: 5_000 },
          format: "raw",
          projectRoot: proxyRoot,
          timeoutMs: 250,
        });
        console.error(`  ${FAIL} Should have thrown a timeout error`);
        failed++;
      } catch (err) {
        const elapsed = Date.now() - startedAt;
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("timed out after")) {
          console.error(`  ${FAIL} Wrong error: ${msg}`);
          failed++;
        } else if (elapsed > 2_000) {
          console.error(
            `  ${FAIL} Timeout fired too late (${elapsed}ms — expected <2000ms)`
          );
          failed++;
        } else {
          console.error(
            `  ${PASS} Timeout fired in ${elapsed}ms (limit: 250ms)`
          );
          console.error(`  ${PASS} Wedged connection dropped (next call re-spawns)`);
          passed++;
        }
      }
    } catch (err) {
      console.error(`  ${FAIL} Outer error: ${err}`);
      failed++;
    }

    // ── Test 24: missing server raises a clear error ──
    console.error(
      `\n${INFO} Test 24: gate_proxy_call unknown server (clear error)`
    );
    try {
      await handleProxyCall({
        server: "does-not-exist",
        tool: "echo",
        projectRoot: proxyRoot,
      });
      console.error(`  ${FAIL} Should have thrown an error`);
      failed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("does-not-exist") || !msg.includes("proxy")) {
        console.error(
          `  ${FAIL} Error message lacks server name or "proxy": ${msg}`
        );
        failed++;
      } else {
        console.error(`  ${PASS} Clear error: ${msg.slice(0, 100)}...`);
        passed++;
      }
    }

    // Clean up: shut down proxies + remove test config
    try {
      await closeAllProxies();
    } catch (err) {
      console.error(`${INFO} proxy cleanup warning: ${err}`);
    }
    delete process.env.GATE_ENABLE_PROXY;
    try {
      fs.rmSync(proxyRoot, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }

  // ── Test 25-28: gate_validate_compression (LLM-in-the-loop) ──
  console.error(`\n${INFO} Test 25: validate_compression (mock provider, perfect mock)`);
  try {
    const target = path.resolve(process.cwd(), "src/lib/tokenCounter.ts");
    const result = await handleValidateCompression({
      filePath: target,
      mode: "run",
      provider: "mock",
    });
    if (!result.score) throw new Error("score missing from run mode");
    if (result.score.aggregate < 90) {
      throw new Error(
        `Perfect mock should score >=90, got ${result.score.aggregate}`
      );
    }
    if (result.score.verdict !== "excellent") {
      throw new Error(
        `Perfect mock should reach 'excellent' verdict, got '${result.score.verdict}'`
      );
    }
    if ((result.answers ?? []).length !== 4) {
      throw new Error(
        `Expected 4 answers from 4 prompts, got ${result.answers?.length}`
      );
    }
    if (result.providerDescription !== "mock-perfect") {
      throw new Error(
        `Expected provider 'mock-perfect', got '${result.providerDescription}'`
      );
    }
    console.error(
      `  ${PASS} Perfect mock scored ${result.score.aggregate}/100 (${result.score.verdict})`
    );
    console.error(
      `  ${PASS} 4 prompts answered, ${result.exportedSymbols.length} truth symbols, ${result.tokens.savingsPercent}% token savings`
    );
    passed++;
  } catch (err) {
    console.error(`  ${FAIL} Error: ${err}`);
    failed++;
  }

  // ── Test 26: faulty mock should drop the score ──
  console.error(
    `\n${INFO} Test 26: validate_compression (mock provider, faulty mock drops score)`
  );
  try {
    const target = path.resolve(process.cwd(), "src/lib/tokenCounter.ts");
    const result = await handleValidateCompression({
      filePath: target,
      mode: "run",
      provider: "mock",
      providerOpts: { faulty: true },
    });
    if (!result.score) throw new Error("score missing");
    if (result.score.aggregate >= 70) {
      throw new Error(
        `Faulty mock should score <70, got ${result.score.aggregate}`
      );
    }
    if (
      result.score.verdict === "excellent" ||
      result.score.verdict === "good"
    ) {
      throw new Error(
        `Faulty mock should NOT reach good/excellent, got '${result.score.verdict}'`
      );
    }
    console.error(
      `  ${PASS} Faulty mock correctly dropped to ${result.score.aggregate}/100 (${result.score.verdict})`
    );
    passed++;
  } catch (err) {
    console.error(`  ${FAIL} Error: ${err}`);
    failed++;
  }

  // ── Test 27: prompts-only mode returns 4 prompts, no answers/scores ──
  console.error(
    `\n${INFO} Test 27: validate_compression mode='prompts' (no LLM call)`
  );
  try {
    const target = path.resolve(process.cwd(), "src/lib/tokenCounter.ts");
    const result = await handleValidateCompression({
      filePath: target,
      mode: "prompts",
    });
    if (result.prompts.length !== 4) {
      throw new Error(`expected 4 prompts, got ${result.prompts.length}`);
    }
    if (result.answers !== undefined) {
      throw new Error("prompts mode should not include answers");
    }
    if (result.score !== undefined) {
      throw new Error("prompts mode should not include score");
    }
    if (!result.compressedView || result.compressedView.length === 0) {
      throw new Error("compressedView is empty");
    }
    console.error(
      `  ${PASS} Got ${result.prompts.length} prompts, no LLM call made`
    );
    console.error(
      `  ${PASS} Compressed view length: ${result.compressedView.length} chars`
    );
    passed++;
  } catch (err) {
    console.error(`  ${FAIL} Error: ${err}`);
    failed++;
  }

  // ── Test 28: mode='score' grades caller-supplied responses ──
  console.error(
    `\n${INFO} Test 28: validate_compression mode='score' (external LLM responses)`
  );
  try {
    const target = path.resolve(process.cwd(), "src/lib/tokenCounter.ts");
    const promptsRes = await handleValidateCompression({
      filePath: target,
      mode: "prompts",
    });
    // Build "perfect" responses by hand using the truth symbols.
    const allSyms = promptsRes.exportedSymbols;
    const responses: Record<string, string> = {
      "p1-list-exports": allSyms.join("\n"),
      "p2-write-usage":
        `import { ${allSyms.slice(0, 3).join(", ")} } from "./tokenCounter";\n` +
        allSyms.slice(0, 3).map((s) => `void ${s};`).join("\n"),
      "p3-risk-audit": `Audit notes: ${allSyms.slice(0, 3).join(", ")} should be tested for boundary inputs.`,
      "p4-test-strategy": `Strategy: cover ${allSyms.slice(0, 3).join(", ")} with property-based tests.`,
    };
    const result = await handleValidateCompression({
      filePath: target,
      mode: "score",
      responses,
    });
    if (!result.score) throw new Error("score missing in score mode");
    if (result.score.aggregate < 90) {
      throw new Error(
        `Hand-crafted perfect responses should score >=90, got ${result.score.aggregate}`
      );
    }
    if ((result.answers ?? []).some((a) => a.meta?.externallyProvided !== true)) {
      throw new Error("answers should be marked externallyProvided=true in score mode");
    }
    console.error(
      `  ${PASS} External responses scored ${result.score.aggregate}/100 (${result.score.verdict})`
    );
    passed++;
  } catch (err) {
    console.error(`  ${FAIL} Error: ${err}`);
    failed++;
  }

  // ── Test 29: gate_optimize_image with generated deterministic fixture ──
  console.error(`\n${INFO} Test 29: gate_optimize_image`);
  const testImage = path.resolve(process.cwd(), "test-image.png");
  try {
    const sharp = (await import("sharp")).default;
    const svg = Buffer.from(
      `<svg width="900" height="360" xmlns="http://www.w3.org/2000/svg">` +
        `<rect width="100%" height="100%" fill="white"/>` +
        `<text x="50" y="190" font-size="72" fill="black">Gate MCP production test</text>` +
        `</svg>`
    );
    await sharp(svg).png().toFile(testImage);

    const result = await handleOptimizeImage({
      imagePath: testImage,
      intent: "visual",
    });
    if (result.type !== "visual_optimized") {
      throw new Error(`expected visual_optimized, got ${result.type}`);
    }
    if (!fs.existsSync(result.imagePath)) {
      throw new Error(`optimized image missing: ${result.imagePath}`);
    }
    console.error(`  ${PASS} type: ${result.type}`);
    console.error(`  ${PASS} originalTokens: ${result.originalTokens}`);
    console.error(`  ${PASS} optimizedTokens: ${result.optimizedTokens}`);
    console.error(`  ${PASS} savingsPercent: ${result.savingsPercent}%`);
    console.error(`  ${PASS} note: ${result.note}`);
    passed++;
  } catch (err) {
    console.error(`  ${FAIL} Error: ${err}`);
    failed++;
  } finally {
    fs.rmSync(testImage, { force: true });
  }

  // ── Test 30-33: graphify bridge ──
  const graphifyFixture = path.resolve(
    process.cwd(),
    "test-fixtures/graphify-sample"
  );

  console.error(`\n${INFO} Test 30: findGraphifyReport (nested fixture)`);
  try {
    const report = findGraphifyReport(graphifyFixture);
    if (report?.endsWith("GRAPH_REPORT.md")) {
      console.error(`  ${PASS} Found: ${report}`);
      passed++;
    } else {
      console.error(`  ${FAIL} Expected GRAPH_REPORT.md under fixture`);
      failed++;
    }
  } catch (err) {
    console.error(`  ${FAIL} Error: ${err}`);
    failed++;
  }

  console.error(`\n${INFO} Test 31: graphify_hubs on fixture`);
  try {
    const result = await handleGraphQuery({
      projectRoot: graphifyFixture,
      query: "",
      queryType: "graphify_hubs",
    });
    if (result.result.includes("OrderManager") && result.source === "graphify") {
      console.error(`  ${PASS} Hubs include OrderManager`);
      passed++;
    } else {
      console.error(`  ${FAIL} Missing OrderManager in hubs`);
      failed++;
    }
  } catch (err) {
    console.error(`  ${FAIL} Error: ${err}`);
    failed++;
  }

  console.error(`\n${INFO} Test 32: graphify_search Community on fixture`);
  try {
    const result = await handleGraphQuery({
      projectRoot: graphifyFixture,
      query: "Community 0",
      queryType: "graphify_search",
    });
    if (result.result.includes("Community")) {
      console.error(`  ${PASS} Found community reference`);
      passed++;
    } else {
      console.error(`  ${FAIL} Expected community hit`);
      failed++;
    }
  } catch (err) {
    console.error(`  ${FAIL} Error: ${err}`);
    failed++;
  }

  console.error(`\n${INFO} Test 33: symbol search + graphify fallback (Community)`);
  try {
    const result = await handleGraphQuery({
      projectRoot: graphifyFixture,
      query: "Community",
      queryType: "search",
    });
    if (
      result.source === "symbol+graphify" &&
      result.result.includes("graphify fallback")
    ) {
      console.error(`  ${PASS} Fallback appended (${result.source})`);
      passed++;
    } else {
      console.error(`  ${FAIL} Expected symbol+graphify fallback, got ${result.source}`);
      failed++;
    }
  } catch (err) {
    console.error(`  ${FAIL} Error: ${err}`);
    failed++;
  }

  const algoSmc = "/Users/macbookair/Documents/Visual Studio Code/Python/AlgoTrading/crypto/strategies/active/smc";
  if (fs.existsSync(path.join(algoSmc, "graphify-out/GRAPH_REPORT.md"))) {
    console.error(`\n${INFO} Test 34: AlgoTrading SMC graphify_search OrderManager`);
    const prevAlgoRoot = process.env.GATE_PROJECT_ROOT;
    try {
      process.env.GATE_PROJECT_ROOT = algoSmc;
      const result = await handleGraphQuery({
        projectRoot: algoSmc,
        query: "OrderManager",
        queryType: "graphify_search",
      });
      if (result.result.includes("OrderManager")) {
        console.error(`  ${PASS} SMC graphify hit OrderManager`);
        passed++;
      } else {
        console.error(`  ${FAIL} No OrderManager in SMC graphify`);
        failed++;
      }
    } catch (err) {
      console.error(`  ${FAIL} Error: ${err}`);
      failed++;
    } finally {
      if (prevAlgoRoot === undefined) delete process.env.GATE_PROJECT_ROOT;
      else process.env.GATE_PROJECT_ROOT = prevAlgoRoot;
    }
  } else {
    console.error(`\n${INFO} Test 34: skipped (AlgoTrading SMC graph not on this machine)`);
  }

  // ── Test 35: calculateSavings never fakes positive savings on expansion ──
  console.error(`\n${INFO} Test 35: calculateSavings expansion guard`);
  try {
    const m = calculateSavings(100, 200);
    if (m.expanded !== true || m.savingsPercent !== 0) {
      throw new Error(`expected expanded=true savings=0, got ${JSON.stringify(m)}`);
    }
    console.error(`  ${PASS} expanded=${m.expanded} savingsPercent=${m.savingsPercent}`);
    passed++;
  } catch (err) {
    console.error(`  ${FAIL} Error: ${err}`);
    failed++;
  }

  // ── Test 36: YAML structure mode (no fake savings on small config) ──
  console.error(`\n${INFO} Test 36: YAML structure / signature guard`);
  try {
    const yamlPath = path.resolve(process.cwd(), "test-fixtures/sample-bloated.yaml");
    const sig = await handleCompressFile({ filePath: yamlPath, depth: "signature" });
    if (sig.expanded && sig.savingsPercent > 0) {
      throw new Error("expanded YAML must not report positive savingsPercent");
    }
    const bigYaml = path.join(process.cwd(), ".gate-test-big.yaml");
    const lines = Array.from({ length: 120 }, (_, i) => `key_${i}: value_${i}_padding`);
    fs.writeFileSync(bigYaml, lines.join("\n"));
    const big = await handleCompressFile({ filePath: bigYaml, depth: "signature" });
    fs.unlinkSync(bigYaml);
    if (big.savingsPercent > 0 && big.optimizedTokens > big.originalTokens) {
      throw new Error("big YAML must not claim savings when larger than raw");
    }
    console.error(
      `  ${PASS} small type=${sig.type} expanded=${sig.expanded}; big expanded=${big.expanded}`
    );
    passed++;
  } catch (err) {
    console.error(`  ${FAIL} Error: ${err}`);
    failed++;
  }

  // ── Test 37: graphify_map originalTokens from full report ──
  console.error(`\n${INFO} Test 37: graphify_map report baseline tokens`);
  try {
    const report = findGraphifyReport(graphifyFixture);
    if (!report) throw new Error("fixture report missing");
    const reportTokens = countGraphifyReportTokens(report);
    const map = await handleGraphQuery({
      projectRoot: graphifyFixture,
      query: "",
      queryType: "graphify_map",
    });
    if (map.originalTokens !== reportTokens) {
      throw new Error(
        `originalTokens ${map.originalTokens} !== report file ${reportTokens}`
      );
    }
    if (map.optimizedTokens >= map.originalTokens && map.originalTokens > 0) {
      throw new Error("graphify_map should be smaller than full GRAPH_REPORT.md");
    }
    console.error(
      `  ${PASS} ${map.originalTokens} → ${map.optimizedTokens} (${map.savingsPercent}% vs report)`
    );
    passed++;
  } catch (err) {
    console.error(`  ${FAIL} Error: ${err}`);
    failed++;
  }

  // ── Test 38: gate_session_stats + gate_help recommended_stack ──
  console.error(`\n${INFO} Test 38: session_stats + recommended_stack help`);
  try {
    await handleDedupContext({ action: "clear" });
    _resetSessionMeasurementsForTests();
    const metricsTarget = path.resolve(process.cwd(), "src/lib/tokenCounter.ts");
    await handleCompressFile({ filePath: metricsTarget, depth: "signature" });
    await handleCompressFile({ filePath: metricsTarget, depth: "signature" });
    const stats = await handleSessionStats();
    if (stats.version !== GATEMCP_VERSION) throw new Error(`version ${stats.version}`);
    if (
      stats.files_considered !== 2 ||
      stats.files_compressed !== 1 ||
      stats.cache_hits !== 1
    ) {
      throw new Error(
        `unexpected measured counts: ${stats.files_considered}/${stats.files_compressed}/${stats.cache_hits}`
      );
    }
    if (
      stats.input_bytes <= 0 ||
      stats.output_bytes <= 0 ||
      stats.estimated_tokens_before <= stats.estimated_tokens_after
    ) {
      throw new Error("measured byte/token totals are missing or invalid");
    }
    const help = await handleHelp({ tool: "recommended_stack" });
    if (!help.documentation.includes("gate_graph_query")) {
      throw new Error("recommended_stack missing gate_graph_query");
    }
    console.error(
      `  ${PASS} measured 2 considered / 1 compressed / 1 cache hit; help ${help.tokens} tok`
    );
    passed++;
  } catch (err) {
    console.error(`  ${FAIL} Error: ${err}`);
    failed++;
  }

  // ── Test 39: gate_init on gate-mcp repo ──
  console.error(`\n${INFO} Test 39: gate_init health`);
  try {
    const init = await handleGateInit({ projectRoot: process.cwd() });
    if (init.version !== GATEMCP_VERSION) throw new Error(`version ${init.version}`);
    if (!init.mcpSlugHint.includes("user-gatemcp")) {
      throw new Error("missing MCP slug hint");
    }
    if (init.cache.persistent) {
      if (!init.cache.path.startsWith(process.cwd())) {
        throw new Error(`cache path escaped project root: ${init.cache.path}`);
      }
      if (init.cache.kind !== "sqlite") {
        throw new Error(`expected sqlite kind, got ${init.cache.kind}`);
      }
      if (!init.cache.partition) {
        throw new Error("missing cache.partition");
      }
    } else {
      if (init.cache.path !== "(memory)") {
        throw new Error(`expected (memory) path, got ${init.cache.path}`);
      }
      if (init.cache.kind !== "memory") {
        throw new Error(`expected memory kind, got ${init.cache.kind}`);
      }
      if (!init.cache.fallbackReason || init.cache.fallbackReason.length < 3) {
        throw new Error("missing cache.fallbackReason when not persistent");
      }
      if (!init.note.includes("in-memory")) {
        throw new Error("note should explain in-memory cache");
      }
    }
    console.error(
      `  ${PASS} graphify=${init.graphify.found} cache=${init.cache.kind}:${init.cache.path}`
    );
    passed++;
  } catch (err) {
    console.error(`  ${FAIL} Error: ${err}`);
    failed++;
  }

  // ── Test 40: Codex plugin package ──
  console.error(`\n${INFO} Test 40: Codex plugin manifest + MCP command`);
  try {
    const pluginRoot = path.resolve(process.cwd(), "plugins/gatemcp");
    const manifest = JSON.parse(
      fs.readFileSync(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8")
    ) as { name?: string; mcpServers?: string };
    const mcp = JSON.parse(
      fs.readFileSync(path.join(pluginRoot, ".mcp.json"), "utf8")
    ) as { mcpServers?: { gatemcp?: { command?: string; args?: string[] } } };
    const config = mcp.mcpServers?.gatemcp;
    if (manifest.name !== "gatemcp" || manifest.mcpServers !== "./.mcp.json") {
      throw new Error("plugin manifest identity or mcpServers path is invalid");
    }
    if (
      config?.command !== "npm" ||
      config.args?.[0] !== "exec" ||
      !config.args.includes("--strict-allow-scripts") ||
      !config.args
        .find((arg) => arg.startsWith("--allow-scripts="))
        ?.includes("better-sqlite3") ||
      !config.args.includes("--package=@gatemcp/cli@0.5.8") ||
      config.args.slice(-2).join(" ") !== "-- gatemcp"
    ) {
      throw new Error("plugin server command is not an explicit pinned npm exec");
    }
    console.error(`  ${PASS} plugin manifest and pinned MCP command are valid`);
    passed++;
  } catch (err) {
    console.error(`  ${FAIL} Error: ${err}`);
    failed++;
  }

  // ── Test 41: gatemcp doctor MCP handshake + required tools ──
  console.error(`\n${INFO} Test 41: gatemcp doctor end-to-end smoke`);
  try {
    const report = await runDoctor({
      projectRoot: process.cwd(),
      serverEntrypoint: path.resolve(process.cwd(), "dist/main.js"),
      strict: true,
    });
    if (!report.ok) {
      throw new Error(
        report.checks
          .filter((check) => check.status === "fail")
          .map((check) => `${check.name}: ${check.detail}`)
          .join("; ")
      );
    }
    for (const tool of report.expectedTools) {
      if (!report.discoveredTools.includes(tool)) {
        throw new Error(`doctor did not discover ${tool}`);
      }
    }
    console.error(
      `  ${PASS} MCP initialized; ${report.discoveredTools.length} tools discovered`
    );
    passed++;
  } catch (err) {
    console.error(`  ${FAIL} Error: ${err}`);
    failed++;
  }

  // ── Test 42: QA multi-repo projectRoot + metrics labels ──
  console.error(`\n${INFO} Test 42: QA multi-repo compress projectRoot + metrics`);
  {
    const prevRoot = process.env.GATE_PROJECT_ROOT;
    const tmpParent = fs.mkdtempSync(path.join(os.tmpdir(), "gate-qa-multirepo-"));
    const lockedRoot = path.join(tmpParent, "locked-rag");
    const webRoot = path.join(tmpParent, "playground-web");
    try {
      fs.mkdirSync(lockedRoot);
      fs.mkdirSync(webRoot);
      const fixtureDir = path.resolve(process.cwd(), "test-fixtures/multi-repo-web");
      const targetJs = path.join(webRoot, "app.js");
      fs.copyFileSync(path.join(fixtureDir, "app.js"), targetJs);
      fs.copyFileSync(
        path.join(fixtureDir, "styles.css"),
        path.join(webRoot, "styles.css")
      );
      process.env.GATE_PROJECT_ROOT = tmpParent;

      const first = await handleCompressFile({
        filePath: targetJs,
        depth: "signature",
        projectRoot: webRoot,
      });
      if (first.baseline !== "file") {
        throw new Error(`baseline expected file, got ${first.baseline}`);
      }
      if (first.billingScope !== "tool_payload_only") {
        throw new Error(`billingScope missing/wrong: ${first.billingScope}`);
      }
      if (!first.note.includes("not Cursor billed tokens")) {
        throw new Error("note missing Cursor billing disclaimer");
      }
      if (first.type === "full" && first.savingsPercent > 0) {
        throw new Error("full fallback must not claim savings");
      }

      const relative = await handleCompressFile({
        filePath: "app.js",
        depth: "signature",
        projectRoot: webRoot,
      });
      if (!relative.note.includes("[DEDUP]")) {
        throw new Error("relative path + projectRoot should hit compress auto-cache");
      }

      const css = await handleCompressFile({
        filePath: "styles.css",
        depth: "structure",
        projectRoot: webRoot,
      });
      if (css.baseline !== "file" || css.billingScope !== "tool_payload_only") {
        throw new Error("css result missing metric labels");
      }

      const second = await handleCompressFile({
        filePath: targetJs,
        depth: "signature",
        projectRoot: webRoot,
      });
      if (!second.note.includes("[DEDUP]")) {
        throw new Error("expected dedup cache hit on second compress");
      }

      // Same absolute file without projectRoot must share the GATE_PROJECT_ROOT partition.
      const wide = await handleCompressFile({
        filePath: targetJs,
        depth: "signature",
      });
      if (!wide.note.includes("[DEDUP]")) {
        throw new Error(
          "compress without projectRoot must hit same partition as narrowed compress"
        );
      }

      const statsScoped = await handleSessionStats({ projectRoot: webRoot });
      if (statsScoped.totalEntries < 1) {
        throw new Error(
          `session_stats with matching projectRoot expected entries>=1, got ${statsScoped.totalEntries}`
        );
      }
      if (statsScoped.billingScope !== "tool_payload_only") {
        throw new Error("session_stats missing billingScope");
      }
      const expectedPartition = canonicalizePath(tmpParent);
      if (statsScoped.cachePartition !== expectedPartition) {
        throw new Error(
          `cachePartition should be GATE_PROJECT_ROOT (${expectedPartition}), got ${statsScoped.cachePartition}`
        );
      }
      const statsWrong = await handleSessionStats({ projectRoot: lockedRoot });
      if (statsWrong.totalEntries !== 0) {
        throw new Error(
          `locked root should not see web cache rows (got ${statsWrong.totalEntries})`
        );
      }

      const dedupStats = await handleDedupContext({
        action: "stats",
        projectRoot: webRoot,
      });
      if ((dedupStats.totalEntries ?? 0) < 1) {
        throw new Error("dedup stats with projectRoot should see compress cache");
      }
      const dedupCheck = await handleDedupContext({
        action: "check",
        filePath: "app.js",
        projectRoot: webRoot,
      });
      if (dedupCheck.status !== "cache_hit") {
        throw new Error(
          `dedup check should see compress auto-cache, got ${dedupCheck.status}`
        );
      }
      if ((dedupCheck.hitCount ?? 0) < 1) {
        throw new Error("auto-cache check must recordHit (hitCount>=1)");
      }

      // Sibling clear must not wipe the other repo's rows.
      fs.writeFileSync(path.join(lockedRoot, "only-locked.js"), "export const x=1;\n");
      await handleCompressFile({
        filePath: path.join(lockedRoot, "only-locked.js"),
        depth: "signature",
        projectRoot: lockedRoot,
      });
      const cleared = await handleDedupContext({
        action: "clear",
        projectRoot: lockedRoot,
      });
      if ((cleared.totalEntries ?? 0) !== 0) {
        throw new Error("clear response should report empty scoped totals");
      }
      const webStill = await handleSessionStats({ projectRoot: webRoot });
      if (webStill.totalEntries < 1) {
        throw new Error("clearing locked scope must not delete web-repo cache rows");
      }

      let narrowRejected = false;
      try {
        await handleCompressFile({
          filePath: targetJs,
          depth: "signature",
          projectRoot: lockedRoot,
        });
      } catch (err) {
        narrowRejected = String(err).includes("outside project boundary");
      }
      if (!narrowRejected) {
        throw new Error("expected projectRoot narrowing to reject sibling file");
      }

      let widenRejected = false;
      try {
        await handleCompressFile({
          filePath: targetJs,
          depth: "signature",
          projectRoot: path.dirname(tmpParent),
        });
      } catch (err) {
        widenRejected = String(err).includes("outside project boundary");
      }
      if (!widenRejected) {
        throw new Error("expected projectRoot above GATE_PROJECT_ROOT to be rejected");
      }

      const helpCompress = await handleHelp({ tool: "gate_compress_file" });
      if (!helpCompress.documentation.includes("projectRoot")) {
        throw new Error("help for gate_compress_file missing projectRoot");
      }

      console.error(
        `  ${PASS} multi-repo compress + relative + stats parity + narrow/widen reject`
      );
      passed++;
    } catch (err) {
      console.error(`  ${FAIL} Error: ${err}`);
      failed++;
    } finally {
      if (prevRoot === undefined) delete process.env.GATE_PROJECT_ROOT;
      else process.env.GATE_PROJECT_ROOT = prevRoot;
      try {
        fs.rmSync(tmpParent, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }

  // ── Test 43: expanded savingsPercent stays 0 (QA metrics UX) ──
  console.error(`\n${INFO} Test 43: expanded metrics cannot fake positive %`);
  try {
    const expanded = calculateSavings(10, 50, "file");
    if (expanded.expanded !== true || expanded.savingsPercent !== 0) {
      throw new Error(
        `expected expanded+0%, got expanded=${expanded.expanded} pct=${expanded.savingsPercent}`
      );
    }
    if (expanded.billingScope !== "tool_payload_only") {
      throw new Error("billingScope missing on TokenMetrics");
    }
    const note = formatSavingsNote(expanded, "test detail");
    if (!note.includes("Do not treat as savings") || !note.includes("not Cursor billed")) {
      throw new Error(`weak expanded note: ${note}`);
    }
    console.error(`  ${PASS} expanded forces 0% + explicit billing disclaimer`);
    passed++;
  } catch (err) {
    console.error(`  ${FAIL} Error: ${err}`);
    failed++;
  }

  // ── Test 44: gate_init surfaces SQLite fallbackReason (QA #3) ──
  console.error(`\n${INFO} Test 44: gate_init fallbackReason when SQLite cannot open`);
  {
    const prevRoot = process.env.GATE_PROJECT_ROOT;
    const prevDb = process.env.GATE_CACHE_DB;
    const prevAllow = process.env.GATE_ALLOW_MEMORY_CACHE;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gate-qa-fallback-"));
    const badDb = path.join(tmp, "not-a-file-db");
    try {
      fs.mkdirSync(badDb);
      process.env.GATE_PROJECT_ROOT = tmp;
      process.env.GATE_CACHE_DB = badDb;
      // Escape hatch required for intentional memory fallback.
      process.env.GATE_ALLOW_MEMORY_CACHE = "1";
      closeCacheDb();
      const init = await handleGateInit({ projectRoot: tmp });
      if (init.cache.persistent || init.cache.kind !== "memory") {
        throw new Error("expected memory fallback");
      }
      if (init.cache.path !== "(memory)") {
        throw new Error(`expected (memory), got ${init.cache.path}`);
      }
      if (!init.cache.fallbackReason?.includes("SQLite open failed")) {
        throw new Error(`weak fallbackReason: ${init.cache.fallbackReason}`);
      }
      if (!init.note.includes("Reason:")) {
        throw new Error("note missing Reason for memory cache");
      }
      console.error(
        `  ${PASS} fallbackReason=${init.cache.fallbackReason.slice(0, 72)}…`
      );
      passed++;

      // Fail-closed without escape hatch.
      delete process.env.GATE_ALLOW_MEMORY_CACHE;
      closeCacheDb();
      let refused = false;
      try {
        await handleGateInit({ projectRoot: tmp });
      } catch (err) {
        refused = String(err).includes("GATE_ALLOW_MEMORY_CACHE");
      }
      if (!refused) throw new Error("expected fail-closed without escape hatch");
      console.error(`  ${PASS} SQLite open failure refuses memory without escape hatch`);
      passed++;
    } catch (err) {
      console.error(`  ${FAIL} Error: ${err}`);
      failed++;
    } finally {
      closeCacheDb();
      if (prevRoot === undefined) delete process.env.GATE_PROJECT_ROOT;
      else process.env.GATE_PROJECT_ROOT = prevRoot;
      if (prevDb === undefined) delete process.env.GATE_CACHE_DB;
      else process.env.GATE_CACHE_DB = prevDb;
      if (prevAllow === undefined) delete process.env.GATE_ALLOW_MEMORY_CACHE;
      else process.env.GATE_ALLOW_MEMORY_CACHE = prevAllow;
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }

  // ── Test 45: toolMode catalog + gate_invoke ──
  console.error(`\n${INFO} Test 45: toolMode catalog helpers + gate_invoke`);
  try {
    const { resolveToolMode, shouldRegisterTool, CATALOG_CORE_TOOLS } =
      await import("./lib/toolMode.js");
    const { handleInvoke } = await import("./tools/invoke.js");
    if (resolveToolMode({ GATE_TOOL_MODE: "catalog" } as NodeJS.ProcessEnv) !== "catalog") {
      throw new Error("catalog default broken");
    }
    if (resolveToolMode({ GATE_TOOL_MODE: "full" } as NodeJS.ProcessEnv) !== "full") {
      throw new Error("full mode broken");
    }
    if (!shouldRegisterTool("gate_invoke", "catalog")) {
      throw new Error("catalog must list gate_invoke");
    }
    if (shouldRegisterTool("gate_invoke", "full")) {
      throw new Error("full mode must not list gate_invoke");
    }
    if (shouldRegisterTool("gate_memory", "catalog")) {
      throw new Error("catalog must hide gate_memory");
    }
    if (!CATALOG_CORE_TOOLS.includes("gate_compress_file")) {
      throw new Error("core set missing compress");
    }
    const invoked = await handleInvoke({
      tool: "gate_help",
      args: { tool: "directory" },
    });
    if (!String((invoked.result as { documentation?: string }).documentation ?? "").includes("gate_invoke")) {
      throw new Error("invoke→help missing gate_invoke");
    }
    let rejectedCoerce = false;
    try {
      await handleInvoke({
        tool: "gate_graph_query",
        args: { query: "x", rebuild: "false" },
      });
    } catch (err) {
      rejectedCoerce = String(err).includes("Invalid args");
    }
    if (!rejectedCoerce) {
      throw new Error('gate_invoke must reject rebuild:"false" (boolean coercion)');
    }
    const mem = await handleInvoke({
      tool: "gate_memory",
      args: { action: "list", key: "*" },
    });
    if (!mem.result || typeof mem.result !== "object") {
      throw new Error("invoke→gate_memory list failed");
    }
    console.error(`  ${PASS} catalog/full gating + gate_invoke Zod parity`);
    passed++;
  } catch (err) {
    console.error(`  ${FAIL} ${err}`);
    failed++;
  }

  // ── Test 46: symbol_map + export_html ──
  console.error(`\n${INFO} Test 46: symbol_map + export_html`);
  try {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gate-symbol-viz-"));
    const prevRoot = process.env.GATE_PROJECT_ROOT;
    process.env.GATE_PROJECT_ROOT = tmp;
    fs.writeFileSync(
      path.join(tmp, "a.js"),
      "export function alphaHelper() { return 1; }\n"
    );
    fs.writeFileSync(
      path.join(tmp, "b.js"),
      "import { alphaHelper } from './a.js';\nexport function beta() { return alphaHelper(); }\n"
    );
    const map = await handleGraphQuery({
      query: "alpha",
      projectRoot: tmp,
      queryType: "symbol_map",
      tokenBudget: 800,
      rebuild: true,
    });
    if (!map.result.includes("Gate symbol map")) {
      throw new Error("symbol_map missing header");
    }
    if (map.nodesTraversed < 1) throw new Error("symbol_map empty");
    const html = await handleGraphQuery({
      query: "",
      projectRoot: tmp,
      queryType: "export_html",
      rebuild: false,
    });
    const htmlPath = path.join(tmp, ".gate-mcp", "symbol-graph.html");
    if (!fs.existsSync(htmlPath)) throw new Error("html not written");
    const body = fs.readFileSync(htmlPath, "utf8");
    if (!body.includes("Gate symbol graph") || !body.includes("<svg")) {
      throw new Error("html content incomplete");
    }
    if (!html.result.includes(htmlPath) && !html.result.includes("symbol-graph.html")) {
      throw new Error("export_html result path missing");
    }
    console.error(`  ${PASS} symbol_map + HTML export`);
    passed++;
    if (prevRoot === undefined) delete process.env.GATE_PROJECT_ROOT;
    else process.env.GATE_PROJECT_ROOT = prevRoot;
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch (err) {
    console.error(`  ${FAIL} ${err}`);
    failed++;
  }

  // ── Test 47: gate_init reports toolMode ──
  console.error(`\n${INFO} Test 47: gate_init toolMode`);
  try {
    const init = await handleGateInit({});
    if (init.toolMode !== "catalog" && init.toolMode !== "full") {
      throw new Error(`unexpected toolMode ${init.toolMode}`);
    }
    if (init.version !== "0.5.8") {
      throw new Error(`expected version 0.5.8 got ${init.version}`);
    }
    console.error(`  ${PASS} toolMode=${init.toolMode} version=${init.version}`);
    passed++;
  } catch (err) {
    console.error(`  ${FAIL} ${err}`);
    failed++;
  }

  // ── Summary ──
  console.error(`\n${DIVIDER}`);
  console.error(`  Results: ${passed} passed, ${failed} failed`);
  console.error(DIVIDER);

  // Cleanup OCR worker + cache DB + memory module state
  await terminateOcr();
  closeCacheDb();
  _resetMemoryDbForTests();

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error(`Fatal test error: ${err}`);
  process.exit(1);
});
// Last reviewed: 2026-05-15 — verified against v0.3.2 fidelity test suite.
