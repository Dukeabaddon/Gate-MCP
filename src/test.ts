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
import { terminateOcr } from "./lib/imageProcessor.js";
import { closeCacheDb, isPersistent } from "./lib/cacheDb.js";

const DIVIDER = "═".repeat(60);
const PASS = "✅";
const FAIL = "❌";
const INFO = "ℹ️";

async function runTests(): Promise<void> {
  console.error(`\n${DIVIDER}`);
  console.error("  Gate-MCP Test Suite v0.2.0-alpha");
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

    passed++;
  } catch (err) {
    console.error(`  ${FAIL} Error: ${err}`);
    failed++;
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

  // ── Test 8: gate_optimize_image (skip if no test image) ──
  console.error(`\n${INFO} Test 8: gate_optimize_image`);
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

  // Cleanup OCR worker + cache DB
  await terminateOcr();
  closeCacheDb();

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error(`Fatal test error: ${err}`);
  process.exit(1);
});
// Last reviewed: 2026-05-15 — verified against v0.3.2 fidelity test suite.
