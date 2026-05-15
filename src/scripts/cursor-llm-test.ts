/**
 * gatemcp v0.3.2 — Cursor-as-LLM Round-Trip Test (Experiment #4b).
 *
 * This script answers a qualitative question that complements the
 * quantitative recall test:
 *
 *   "If I gave an LLM ONLY the compressed view of these files, could it
 *    write code that correctly imports and uses them?"
 *
 * Method:
 *   Render the compressed view of a chosen file and side-by-side report
 *   the raw stats. The output is meant to be eyeballed by a developer
 *   (or pasted into a fresh chat) — there's no automatic LLM call. This
 *   keeps the test reproducible and free.
 *
 * Usage:
 *   node dist/scripts/cursor-llm-test.js <target-file>
 *
 * Example:
 *   node dist/scripts/cursor-llm-test.js ~/demo/react/packages/react-reconciler/src/ReactFiberWorkLoop.js
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  detectLanguage,
  extractSignatures,
  formatSignature,
} from "../lib/astParser.js";
import { countTextTokens } from "../lib/tokenCounter.js";

function expandHome(p: string): string {
  if (p.startsWith("~")) return path.join(os.homedir(), p.slice(1));
  return p;
}

function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: cursor-llm-test <target-file>");
    process.exit(1);
  }
  const f = path.resolve(expandHome(arg));
  if (!fs.existsSync(f)) {
    console.error(`File not found: ${f}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(f, "utf-8");
  const language = detectLanguage(f);

  const rawTokens = countTextTokens(raw);
  const rawChars = raw.length;
  const rawLines = raw.split("\n").length;

  const sig = extractSignatures(raw, language);
  const compressed = formatSignature(sig, language);
  const compressedTokens = countTextTokens(compressed);
  const compressedChars = compressed.length;
  const compressedLines = compressed.split("\n").length;

  const savings = Math.round(((rawTokens - compressedTokens) / rawTokens) * 100);

  console.log(`Target: ${f}`);
  console.log(`Language: ${language}`);
  console.log("");
  console.log("┌────────────────┬──────────────┬──────────────┬────────────┐");
  console.log("│ Metric         │ Raw          │ Compressed   │ Reduction  │");
  console.log("├────────────────┼──────────────┼──────────────┼────────────┤");
  console.log(`│ Tokens         │ ${String(rawTokens).padStart(12)} │ ${String(compressedTokens).padStart(12)} │ ${String(savings + "%").padStart(10)} │`);
  console.log(`│ Chars          │ ${String(rawChars).padStart(12)} │ ${String(compressedChars).padStart(12)} │ ${String(Math.round(((rawChars - compressedChars) / rawChars) * 100) + "%").padStart(10)} │`);
  console.log(`│ Lines          │ ${String(rawLines).padStart(12)} │ ${String(compressedLines).padStart(12)} │ ${String(Math.round(((rawLines - compressedLines) / rawLines) * 100) + "%").padStart(10)} │`);
  console.log("└────────────────┴──────────────┴──────────────┴────────────┘");
  console.log("");
  console.log("Structural breakdown:");
  console.log(`  Imports:   ${sig.imports.length}`);
  console.log(`  Exports:   ${sig.exports.length}`);
  console.log(`  Functions: ${sig.functions.length}`);
  console.log(`  Classes:   ${sig.classes.length}`);
  console.log("");
  console.log("─────────── COMPRESSED VIEW (what an LLM would see) ───────────");
  console.log(compressed);
  console.log("─────────── END COMPRESSED VIEW ───────────");
  console.log("");
  console.log("Validation prompts to try in a fresh Cursor chat:");
  console.log(`  1. "Given only this compressed view, list every public symbol exported from this module."`);
  console.log(`  2. "Write a new file that imports from this module and uses at least 3 of its exports correctly."`);
  console.log(`  3. "Could this module be a memory leak risk based on what you see?"`);
  console.log(`  4. "What testing strategy would you recommend for this module?"`);
  console.log("");
  console.log(`Compare answers against the raw file (${rawLines} lines, ${rawTokens} tokens) to judge`);
  console.log(`whether the compressed view preserves enough signal for real work.`);
}

main();
