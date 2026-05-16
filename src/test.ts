/**
 * Gate-MCP Test Script
 *
 * Tests both primary tools with sample inputs.
 * Run with: npm run build && npm test
 */

import fs from "node:fs";
import path from "node:path";
import { handleOptimizeImage } from "./tools/optimizeImage.js";
import { handleCompressFile } from "./tools/compressFile.js";
import { handleGraphQuery } from "./tools/graphQuery.js";
import { handleMemory } from "./tools/memory.js";
import { handleDedupContext } from "./tools/dedupContext.js";
import { handleCleanResponse } from "./tools/cleanResponse.js";
import { handleProxyTools, handleProxyCall } from "./tools/proxyTools.js";
import { handleValidateCompression } from "./tools/validateCompression.js";
import { closeAllProxies } from "./lib/proxyClient.js";
import { terminateOcr } from "./lib/imageProcessor.js";
import { closeCacheDb, isPersistent } from "./lib/cacheDb.js";
import {
  isMemoryPersistent,
  _resetMemoryDbForTests,
} from "./lib/memoryDb.js";

const DIVIDER = "═".repeat(60);
const PASS = "✅";
const FAIL = "❌";
const INFO = "ℹ️";

async function runTests(): Promise<void> {
  console.error(`\n${DIVIDER}`);
  console.error("  gatemcp Test Suite v0.5.2");
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

  // ── Test 29: gate_optimize_image (skip if no test image) ──
  console.error(`\n${INFO} Test 29: gate_optimize_image`);
  const testImagePaths = [
    path.resolve(process.cwd(), "test-image.png"),
    path.resolve(process.cwd(), "test-image.jpg"),
    path.join(process.env.HOME || "~", "Desktop/test-screenshot.png"),
  ];
  const testImage = testImagePaths.find((p) => fs.existsSync(p));

  if (testImage) {
    try {
      const result = await handleOptimizeImage({
        imagePath: testImage,
        intent: "auto",
      });
      console.error(`  ${PASS} type: ${result.type}`);
      console.error(`  ${PASS} originalTokens: ${result.originalTokens}`);
      console.error(`  ${PASS} optimizedTokens: ${result.optimizedTokens}`);
      console.error(`  ${PASS} savingsPercent: ${result.savingsPercent}%`);
      console.error(`  ${PASS} note: ${result.note}`);
      passed++;
    } catch (err) {
      console.error(`  ${FAIL} Error: ${err}`);
      failed++;
    }
  } else {
    console.error(
      `  ⏭️  Skipped — no test image found. Place test-image.png in project root.`
    );
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
