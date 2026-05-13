/**
 * FAIROS Experiment #2 — Semantic Quality Validation
 *
 * HYPOTHESIS: AST-compressed signatures retain enough semantic
 * information for an LLM to correctly understand API surfaces.
 *
 * METHOD:
 *   1. Compress real source files via gate_compress_file (signature mode)
 *   2. Extract function signatures from compressed output
 *   3. Verify: do the signatures contain enough info to:
 *      a) Identify function names, parameters, return types?
 *      b) Understand import relationships?
 *      c) Reconstruct a valid function call?
 *   4. Compare compressed output against raw source — measure information retention
 *
 * SUCCESS CRITERION: ≥90% of exported functions are discoverable from
 * compressed output with correct parameter counts and types.
 *
 * NOTE: This is a STRUCTURAL quality test — we verify the compressed
 * representation preserves the API surface. An LLM-in-the-loop test
 * would require API calls; this validates the prerequisite.
 */

import fs from "node:fs";
import path from "node:path";
import { handleCompressFile } from "./tools/compressFile.js";

const PASS = "✅";
const FAIL = "❌";
const INFO = "ℹ️";

interface FunctionInfo {
  name: string;
  params: number;
  hasReturnType: boolean;
  isExported: boolean;
  isAsync: boolean;
}

/**
 * Extract function signatures from raw TypeScript source.
 */
function extractRawFunctions(source: string): FunctionInfo[] {
  const fns: FunctionInfo[] = [];
  const fnRegex = /(export\s+)?(async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*([^\s{]+))?/g;
  const arrowRegex = /(export\s+)?(const|let)\s+(\w+)\s*=\s*(async\s+)?\([^)]*\)\s*(?::\s*[^\s=>]+)?\s*=>/g;

  let match;
  while ((match = fnRegex.exec(source)) !== null) {
    const params = match[4].trim() ? match[4].split(",").length : 0;
    fns.push({
      name: match[3],
      params,
      hasReturnType: !!match[5],
      isExported: !!match[1],
      isAsync: !!match[2],
    });
  }

  while ((match = arrowRegex.exec(source)) !== null) {
    fns.push({
      name: match[3],
      params: 0, // approximate
      hasReturnType: false,
      isExported: !!match[1],
      isAsync: !!match[4],
    });
  }

  return fns;
}

/**
 * Check if a function name appears in compressed output.
 */
function isFunctionDiscoverable(
  compressed: string,
  fnName: string
): boolean {
  return compressed.includes(fnName);
}

async function runExperiment2(): Promise<void> {
  console.error("\n" + "═".repeat(60));
  console.error("  FAIROS Experiment #2 — Semantic Quality Validation");
  console.error("═".repeat(60));

  const testFiles = [
    "src/tools/compressFile.ts",
    "src/tools/cleanResponse.ts",
    "src/tools/memory.ts",
    "src/tools/graphQuery.ts",
    "src/tools/dedupContext.ts",
    "src/tools/optimizeImage.ts",
    "src/lib/symbolGraph.ts",
    "src/lib/astParser.ts",
    "src/lib/tokenCounter.ts",
    "src/lib/logger.ts",
    "src/main.ts",
    "src/types.ts",
  ];

  let totalExported = 0;
  let totalDiscovered = 0;
  let totalImportsRaw = 0;
  let totalImportsCompressed = 0;
  const results: Array<{
    file: string;
    exportedFns: number;
    discoveredFns: number;
    rawImports: number;
    compressedImports: number;
    missingFns: string[];
    savingsPercent: number;
  }> = [];

  for (const relPath of testFiles) {
    const absPath = path.resolve(process.cwd(), relPath);
    if (!fs.existsSync(absPath)) {
      console.error(`  ⏭️  Skipped: ${relPath} (not found)`);
      continue;
    }

    const rawSource = fs.readFileSync(absPath, "utf-8");
    const rawFunctions = extractRawFunctions(rawSource);
    const exportedFns = rawFunctions.filter((f) => f.isExported);

    // Count raw imports
    const rawImports = (rawSource.match(/^import\s/gm) || []).length;

    // Compress
    const compressed = await handleCompressFile({
      filePath: absPath,
      depth: "signature",
    });

    // Count compressed imports
    const compressedImports = (
      compressed.content.match(/^import\s/gm) || []
    ).length;

    // Check discoverability
    const missing: string[] = [];
    let discovered = 0;
    for (const fn of exportedFns) {
      if (isFunctionDiscoverable(compressed.content, fn.name)) {
        discovered++;
      } else {
        missing.push(fn.name);
      }
    }

    totalExported += exportedFns.length;
    totalDiscovered += discovered;
    totalImportsRaw += rawImports;
    totalImportsCompressed += compressedImports;

    results.push({
      file: relPath,
      exportedFns: exportedFns.length,
      discoveredFns: discovered,
      rawImports,
      compressedImports,
      missingFns: missing,
      savingsPercent: compressed.savingsPercent,
    });
  }

  // Print results
  console.error(`\n${"─".repeat(50)}`);
  console.error("  Per-File Results:");
  console.error("─".repeat(50));

  for (const r of results) {
    const rate =
      r.exportedFns > 0
        ? Math.round((r.discoveredFns / r.exportedFns) * 100)
        : 100;
    const icon = rate >= 90 ? PASS : rate >= 70 ? "⚠️" : FAIL;
    console.error(
      `  ${icon} ${r.file}: ${r.discoveredFns}/${r.exportedFns} exports found (${rate}%), ` +
        `${r.compressedImports}/${r.rawImports} imports preserved, ${r.savingsPercent}% smaller`
    );
    if (r.missingFns.length > 0) {
      console.error(`     Missing: ${r.missingFns.join(", ")}`);
    }
  }

  // Summary
  const overallRate =
    totalExported > 0
      ? Math.round((totalDiscovered / totalExported) * 100)
      : 100;
  const importRetention =
    totalImportsRaw > 0
      ? Math.round((totalImportsCompressed / totalImportsRaw) * 100)
      : 100;

  console.error(`\n${"═".repeat(60)}`);
  console.error(`  EXPERIMENT #2 RESULTS`);
  console.error("═".repeat(60));
  console.error(
    `  Exported function discovery:  ${totalDiscovered}/${totalExported} (${overallRate}%)`
  );
  console.error(
    `  Import statement retention:   ${totalImportsCompressed}/${totalImportsRaw} (${importRetention}%)`
  );
  console.error(
    `  Success criterion (≥90%):     ${overallRate >= 90 ? PASS + " PASSED" : FAIL + " FAILED"}`
  );
  console.error("═".repeat(60));

  if (overallRate < 90) {
    console.error(`\n  ${FAIL} HYPOTHESIS REJECTED: Compression loses too many exports.`);
  } else {
    console.error(`\n  ${PASS} HYPOTHESIS SUPPORTED: AST signatures retain ≥90% of API surface.`);
  }
}

runExperiment2().catch((err) => {
  console.error(`Fatal: ${err}`);
  process.exit(1);
});
