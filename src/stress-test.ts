/**
 * Gate-MCP Stress Test
 *
 * Extended tests covering edge cases, performance, and error resilience.
 * Run with: node dist/stress-test.js
 */

import fs from "node:fs";
import path from "node:path";
import { handleOptimizeImage } from "./tools/optimizeImage.js";
import { handleCompressFile } from "./tools/compressFile.js";
import { handleDedupContext } from "./tools/dedupContext.js";
import { checkCache, storeInCache } from "./tools/dedupContext.js";
import { terminateOcr } from "./lib/imageProcessor.js";
import { closeCacheDb, isPersistent } from "./lib/cacheDb.js";

const DIVIDER = "═".repeat(60);
const PASS = "✅";
const FAIL = "❌";
const INFO = "ℹ️";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
  } catch (err) {
    console.error(`  ${FAIL} ${name}: ${err}`);
    failed++;
  }
}

async function main(): Promise<void> {
  console.error(`\n${DIVIDER}`);
  console.error("  Gate-MCP Stress Test Suite");
  console.error(DIVIDER);

  // ── Compress File: All source files ──
  console.error(`\n${INFO} Stress Test 1: Compress all project .ts files`);
  const srcDir = path.resolve(process.cwd(), "src");
  const tsFiles = findFiles(srcDir, ".ts");
  console.error(`  Found ${tsFiles.length} TypeScript files`);

  for (const file of tsFiles) {
    await test(`compress ${path.basename(file)}`, async () => {
      const result = await handleCompressFile({ filePath: file, depth: "signature" });
      console.error(
        `  ${PASS} ${path.basename(file)}: ${result.originalTokens} → ${result.optimizedTokens} tokens (${result.savingsPercent}% saved)`
      );
      if (result.savingsPercent < 0) throw new Error("Negative savings");
    });
  }

  // ── Compress File: summary mode on all files ──
  console.error(`\n${INFO} Stress Test 2: Summary mode on all .ts files`);
  for (const file of tsFiles) {
    await test(`summary ${path.basename(file)}`, async () => {
      const result = await handleCompressFile({ filePath: file, depth: "summary" });
      console.error(
        `  ${PASS} ${path.basename(file)}: ${result.savingsPercent}% saved (summary)`
      );
    });
  }

  // ── Compress File: full mode ──
  console.error(`\n${INFO} Stress Test 3: Full mode (no compression)`);
  await test("full mode", async () => {
    const result = await handleCompressFile({
      filePath: tsFiles[0],
      depth: "full",
    });
    if (result.savingsPercent !== 0) throw new Error("Full mode should have 0% savings");
    console.error(`  ${PASS} Full mode: 0% savings as expected`);
  });

  // ── Compress File: Python file (create temp) ──
  console.error(`\n${INFO} Stress Test 4: Python file parsing`);
  const pyFile = path.resolve(process.cwd(), "test-sample.py");
  fs.writeFileSync(
    pyFile,
    `
import os
import sys
from pathlib import Path

class DataProcessor:
    def __init__(self, config):
        self.config = config
    
    def process(self, data):
        return [self._transform(item) for item in data]
    
    def _transform(self, item):
        return item.strip().lower()

def main():
    processor = DataProcessor({})
    result = processor.process(["Hello", "World"])
    print(result)

if __name__ == "__main__":
    main()
`.trim()
  );
  await test("python parsing", async () => {
    const result = await handleCompressFile({ filePath: pyFile, depth: "signature" });
    console.error(
      `  ${PASS} Python: ${result.originalTokens} → ${result.optimizedTokens} tokens (${result.savingsPercent}% saved)`
    );
    console.error(`  Content:\n${result.content}`);
  });

  // ── Compress File: Unknown language fallback ──
  console.error(`\n${INFO} Stress Test 5: Unknown language fallback`);
  const txtFile = path.resolve(process.cwd(), "test-sample.txt");
  fs.writeFileSync(txtFile, "This is a plain text file.\nNo code structures here.\nJust text content for testing.\n");
  await test("unknown language", async () => {
    const result = await handleCompressFile({ filePath: txtFile, depth: "signature" });
    console.error(`  ${PASS} Unknown lang: ${result.language}, ${result.savingsPercent}% saved`);
  });

  // ── Image: forced text intent ──
  const testImage = path.resolve(process.cwd(), "test-image.png");
  if (fs.existsSync(testImage)) {
    console.error(`\n${INFO} Stress Test 6: Image with forced text intent`);
    await test("text intent", async () => {
      const result = await handleOptimizeImage({ imagePath: testImage, intent: "text" });
      console.error(
        `  ${PASS} Text intent: ${result.originalTokens} → ${result.optimizedTokens} tokens (${result.savingsPercent}% saved)`
      );
      if (result.type !== "text_extracted") throw new Error("Expected text_extracted type");
    });

    console.error(`\n${INFO} Stress Test 7: Image with forced visual intent`);
    await test("visual intent", async () => {
      const result = await handleOptimizeImage({ imagePath: testImage, intent: "visual" });
      console.error(
        `  ${PASS} Visual intent: ${result.originalTokens} → ${result.optimizedTokens} tokens (${result.savingsPercent}% saved)`
      );
      if (result.type !== "visual_optimized") throw new Error("Expected visual_optimized type");
    });

    console.error(`\n${INFO} Stress Test 8: Repeated image processing (perf)`);
    const start = Date.now();
    for (let i = 0; i < 3; i++) {
      await test(`repeat-${i}`, async () => {
        await handleOptimizeImage({ imagePath: testImage, intent: "visual" });
      });
    }
    const elapsed = Date.now() - start;
    console.error(`  ${PASS} 3 iterations in ${elapsed}ms (avg: ${Math.round(elapsed / 3)}ms)`);
  }

  // ── Error resilience ──
  console.error(`\n${INFO} Stress Test 9: Error resilience`);
  await test("nonexistent image", async () => {
    // Use a path inside the project boundary so the existence check fires
    // (not the boundary check). Then expect "not found" error.
    const missingPath = path.resolve(process.cwd(), "no-such-image.png");
    try {
      await handleOptimizeImage({ imagePath: missingPath });
      throw new Error("Should have thrown");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("not found")) {
        console.error(`  ${PASS} Correctly rejected nonexistent image`);
      } else {
        throw err;
      }
    }
  });

  await test("path traversal rejected", async () => {
    // New v0.3 behavior: paths outside project boundary must be rejected.
    try {
      await handleOptimizeImage({ imagePath: "/etc/passwd" });
      throw new Error("Should have thrown");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("outside project boundary") || msg.includes("sensitive")) {
        console.error(`  ${PASS} Correctly rejected out-of-boundary path`);
      } else {
        throw err;
      }
    }
  });

  await test("directory as file", async () => {
    try {
      await handleCompressFile({ filePath: srcDir });
      throw new Error("Should have thrown");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("directory")) {
        console.error(`  ${PASS} Correctly rejected directory path`);
      } else {
        throw err;
      }
    }
  });

  // ── Stress Test 10: persistent cache — 1,000 stores + 10,000 checks ──
  console.error(`\n${INFO} Stress Test 10: persistent dedup cache (1k stores + 10k checks)`);
  const tmpCacheDir = path.resolve(process.cwd(), ".tmp-cache-stress");
  try {
    fs.mkdirSync(tmpCacheDir, { recursive: true });
    await handleDedupContext({ action: "clear" });
    console.error(`  ${INFO} Cache backend: ${isPersistent() ? "SQLite" : "in-memory Map"}`);

    const N_STORE = 1000;
    const N_CHECK = 10000;
    const HIT_RATIO = 0.8;

    const files: string[] = [];
    for (let i = 0; i < N_STORE; i++) {
      const f = path.join(tmpCacheDir, `file-${i}.txt`);
      fs.writeFileSync(f, `payload-${i}-${"x".repeat(64)}\n`);
      files.push(f);
    }

    const storeStart = Date.now();
    for (let i = 0; i < N_STORE; i++) {
      storeInCache(files[i], `// stub ${i}`, 300 + (i % 200), "file");
    }
    const storeMs = Date.now() - storeStart;
    console.error(`  ${PASS} 1,000 stores in ${storeMs}ms (avg ${(storeMs / N_STORE).toFixed(2)}ms)`);

    let hits = 0;
    let misses = 0;
    const checkStart = Date.now();
    for (let i = 0; i < N_CHECK; i++) {
      const wantHit = Math.random() < HIT_RATIO;
      if (wantHit) {
        const f = files[Math.floor(Math.random() * files.length)];
        const got = checkCache(f);
        if (got) hits++;
        else misses++;
      } else {
        const got = checkCache(path.join(tmpCacheDir, `nonexistent-${i}.txt`));
        if (got) hits++;
        else misses++;
      }
    }
    const checkMs = Date.now() - checkStart;
    console.error(
      `  ${PASS} 10,000 checks in ${checkMs}ms (avg ${(checkMs / N_CHECK).toFixed(3)}ms)`
    );
    console.error(`  ${PASS} ${hits} hits / ${misses} misses (target ratio ~80%)`);

    const stats = await handleDedupContext({ action: "stats" });
    await test("cache backend honored 1k stores", async () => {
      if ((stats.totalEntries ?? 0) < N_STORE) {
        throw new Error(`expected ${N_STORE} entries, got ${stats.totalEntries}`);
      }
    });
    await test("cache backend honored 10k checks", async () => {
      if (hits < N_CHECK * HIT_RATIO * 0.5) {
        throw new Error(`hit rate too low (${hits} of ${N_CHECK})`);
      }
    });
    console.error(`  ${PASS} stats.totalEntries=${stats.totalEntries}, totalHits=${stats.totalHits}`);

    await handleDedupContext({ action: "clear" });
  } catch (err) {
    console.error(`  ${FAIL} dedup cache stress error: ${err}`);
    failed++;
  } finally {
    try { fs.rmSync(tmpCacheDir, { recursive: true, force: true }); } catch {}
  }

  // ── Cleanup ──
  try { fs.unlinkSync(pyFile); } catch {}
  try { fs.unlinkSync(txtFile); } catch {}
  await terminateOcr();
  closeCacheDb();

  // ── Summary ──
  console.error(`\n${DIVIDER}`);
  console.error(`  Stress Test Results: ${passed} passed, ${failed} failed`);
  console.error(DIVIDER);

  if (failed > 0) process.exit(1);
}

function findFiles(dir: string, ext: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFiles(full, ext));
    } else if (entry.name.endsWith(ext)) {
      results.push(full);
    }
  }
  return results;
}

main().catch((err) => {
  console.error(`Fatal: ${err}`);
  process.exit(1);
});
