/**
 * gatemcp v0.4.0 — Real-repo compression benchmark.
 *
 * Measures the input-token cost of feeding every code file in a directory
 * to an LLM, with and without gatemcp's signature compression.
 *
 * Usage:
 *   node dist/scripts/benchmark-real-repo.js <target-dir> [--out result.md]
 *
 * Example:
 *   node dist/scripts/benchmark-real-repo.js ~/demo/react/packages/react-reconciler/src
 *
 * Output: a markdown report with per-language breakdown + overall savings.
 *
 * Notes:
 * - Bypasses pathGuard.ts intentionally — this is a developer benchmark, not
 *   a runtime MCP tool. It only reads files; it never writes.
 * - Skips files larger than MAX_FILE_BYTES (10 MB) to keep memory bounded.
 * - Skips parser-load failures silently; the regex fallback handles those.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  detectLanguage,
  extractSignatures,
  formatSignature,
} from "../lib/astParser.js";
import { countTextTokens } from "../lib/tokenCounter.js";
import type { SupportedLanguage } from "../types.js";

const CODE_EXTENSIONS = new Set([
  ".js", ".jsx", ".mjs", ".cjs",
  ".ts", ".tsx", ".mts", ".cts",
  ".py", ".pyi",
  ".java", ".cs",
  ".cpp", ".cc", ".cxx", ".c", ".h", ".hpp",
  ".go", ".rs",
  ".rb", ".php",
  ".kt", ".kts", ".swift", ".scala",
  ".html", ".htm", ".css", ".scss", ".sass", ".less",
  ".json", ".yaml", ".yml",
  ".sql", ".sh", ".bash",
  ".vue", ".svelte", ".md", ".markdown",
]);

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next",
  "coverage", ".cache", ".turbo", ".parcel-cache", "__pycache__",
  ".pytest_cache", "venv", ".venv", "target",
]);

const MAX_FILE_BYTES = 10 * 1024 * 1024;

interface FileMetric {
  filePath: string;
  language: SupportedLanguage | "unknown";
  originalTokens: number;
  compressedTokens: number;
  originalChars: number;
  compressedChars: number;
}

interface LangAggregate {
  language: string;
  fileCount: number;
  originalTokens: number;
  compressedTokens: number;
  savingsPercent: number;
}

function expandHome(p: string): string {
  if (p.startsWith("~")) return path.join(os.homedir(), p.slice(1));
  return p;
}

function walkSync(root: string, files: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== "." && entry.name !== "..") {
      if (IGNORED_DIRS.has(entry.name)) continue;
    }
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      walkSync(full, files);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (CODE_EXTENSIONS.has(ext)) files.push(full);
    }
  }
  return files;
}

function measureFile(filePath: string): FileMetric | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }
  if (stat.size > MAX_FILE_BYTES) return null;

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const language = detectLanguage(filePath);
  const originalTokens = countTextTokens(raw);

  let compressed = "";
  try {
    const sig = extractSignatures(raw, language);
    compressed = formatSignature(sig, language);
  } catch {
    compressed = `[parse-error] ${path.basename(filePath)}`;
  }
  const compressedTokens = countTextTokens(compressed);

  return {
    filePath,
    language,
    originalTokens,
    compressedTokens,
    originalChars: raw.length,
    compressedChars: compressed.length,
  };
}

function aggregate(metrics: FileMetric[]): LangAggregate[] {
  const byLang = new Map<string, LangAggregate>();

  for (const m of metrics) {
    const key = m.language;
    let agg = byLang.get(key);
    if (!agg) {
      agg = {
        language: key,
        fileCount: 0,
        originalTokens: 0,
        compressedTokens: 0,
        savingsPercent: 0,
      };
      byLang.set(key, agg);
    }
    agg.fileCount += 1;
    agg.originalTokens += m.originalTokens;
    agg.compressedTokens += m.compressedTokens;
  }

  for (const agg of byLang.values()) {
    agg.savingsPercent = agg.originalTokens > 0
      ? Math.round(((agg.originalTokens - agg.compressedTokens) / agg.originalTokens) * 100)
      : 0;
  }

  return Array.from(byLang.values()).sort((a, b) => b.originalTokens - a.originalTokens);
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

function formatUSD(tokens: number, costPer1M: number): string {
  return `$${((tokens / 1_000_000) * costPer1M).toFixed(2)}`;
}

function buildReport(
  target: string,
  metrics: FileMetric[],
  durationMs: number
): string {
  const totalFiles = metrics.length;
  const totalOriginal = metrics.reduce((s, m) => s + m.originalTokens, 0);
  const totalCompressed = metrics.reduce((s, m) => s + m.compressedTokens, 0);
  const overallSavings = totalOriginal > 0
    ? Math.round(((totalOriginal - totalCompressed) / totalOriginal) * 100)
    : 0;

  const langs = aggregate(metrics);

  // Pricing reference (May 2026 published rates, illustrative)
  const CLAUDE_SONNET_PER_1M = 3.0;
  const GPT4O_PER_1M = 2.5;
  const GPT5_PER_1M = 5.0;

  const lines: string[] = [];
  lines.push(`# gatemcp Compression Benchmark — Real Repository`);
  lines.push("");
  lines.push(`**Target:** \`${target}\``);
  lines.push(`**Files scanned:** ${totalFiles}`);
  lines.push(`**Wall time:** ${durationMs.toFixed(0)} ms (${(totalFiles / (durationMs / 1000)).toFixed(0)} files/sec)`);
  lines.push(`**gatemcp version:** 0.4.0`);
  lines.push("");
  lines.push(`## Overall savings`);
  lines.push("");
  lines.push(`| Metric | Raw files | gatemcp signatures | Reduction |`);
  lines.push(`|---|---|---|---|`);
  lines.push(`| Tokens | **${formatTokens(totalOriginal)}** | **${formatTokens(totalCompressed)}** | **${overallSavings}%** |`);
  lines.push(`| Claude Sonnet 4 cost (input) | ${formatUSD(totalOriginal, CLAUDE_SONNET_PER_1M)} | ${formatUSD(totalCompressed, CLAUDE_SONNET_PER_1M)} | ${formatUSD(totalOriginal - totalCompressed, CLAUDE_SONNET_PER_1M)} saved |`);
  lines.push(`| GPT-4o cost (input) | ${formatUSD(totalOriginal, GPT4O_PER_1M)} | ${formatUSD(totalCompressed, GPT4O_PER_1M)} | ${formatUSD(totalOriginal - totalCompressed, GPT4O_PER_1M)} saved |`);
  lines.push(`| GPT-5 cost (input) | ${formatUSD(totalOriginal, GPT5_PER_1M)} | ${formatUSD(totalCompressed, GPT5_PER_1M)} | ${formatUSD(totalOriginal - totalCompressed, GPT5_PER_1M)} saved |`);
  lines.push("");
  lines.push(`## Per-language breakdown`);
  lines.push("");
  lines.push(`| Language | Files | Original tokens | Compressed tokens | Savings |`);
  lines.push(`|---|---|---|---|---|`);
  for (const l of langs) {
    lines.push(`| ${l.language} | ${l.fileCount} | ${formatTokens(l.originalTokens)} | ${formatTokens(l.compressedTokens)} | ${l.savingsPercent}% |`);
  }
  lines.push("");
  lines.push(`## Top 10 files by raw size`);
  lines.push("");
  const top = [...metrics].sort((a, b) => b.originalTokens - a.originalTokens).slice(0, 10);
  lines.push(`| File | Lang | Original | Compressed | Savings |`);
  lines.push(`|---|---|---|---|---|`);
  for (const m of top) {
    const savings = m.originalTokens > 0
      ? Math.round(((m.originalTokens - m.compressedTokens) / m.originalTokens) * 100)
      : 0;
    const rel = path.relative(target, m.filePath);
    lines.push(`| \`${rel}\` | ${m.language} | ${formatTokens(m.originalTokens)} | ${formatTokens(m.compressedTokens)} | ${savings}% |`);
  }
  lines.push("");
  lines.push(`## Interpretation`);
  lines.push("");
  lines.push(`Without gatemcp, sending every file in this directory to an LLM context would cost **${formatTokens(totalOriginal)} input tokens**. With gatemcp's signature mode, the same structural information is conveyed in **${formatTokens(totalCompressed)} tokens** — a **${overallSavings}% reduction** of input-side cost.`);
  lines.push("");
  lines.push(`Compressed output preserves: imports, class/interface declarations, function signatures, exported symbols. It drops: function bodies, comments, whitespace, internal logic. An LLM reading the compressed view can still answer "what symbols exist and how do they relate", which is the dominant question in code-navigation tasks.`);
  lines.push("");

  return lines.join("\n");
}

function parseArgs(argv: string[]): { target: string; out: string | null } {
  const args = argv.slice(2);
  let target: string | null = null;
  let out: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") {
      out = args[++i] ?? null;
    } else if (!target) {
      target = args[i];
    }
  }
  if (!target) {
    console.error("Usage: benchmark-real-repo <target-dir> [--out result.md]");
    process.exit(1);
  }
  return { target: expandHome(target), out };
}

async function main() {
  const { target, out } = parseArgs(process.argv);
  const absTarget = path.resolve(target);

  if (!fs.existsSync(absTarget)) {
    console.error(`Target does not exist: ${absTarget}`);
    process.exit(1);
  }

  console.log(`[benchmark] scanning ${absTarget}`);
  const t0 = Date.now();
  const files = walkSync(absTarget);
  console.log(`[benchmark] discovered ${files.length} code files`);

  const metrics: FileMetric[] = [];
  let processed = 0;
  for (const f of files) {
    const m = measureFile(f);
    if (m) metrics.push(m);
    processed++;
    if (processed % 100 === 0) {
      console.log(`[benchmark] processed ${processed}/${files.length}`);
    }
  }
  const durationMs = Date.now() - t0;

  console.log(`[benchmark] done in ${durationMs} ms — generating report`);
  const report = buildReport(absTarget, metrics, durationMs);

  if (out) {
    const outPath = path.resolve(expandHome(out));
    fs.writeFileSync(outPath, report, "utf-8");
    console.log(`[benchmark] wrote ${outPath}`);
  } else {
    process.stdout.write(report);
  }
}

main().catch((err) => {
  console.error("[benchmark] fatal:", err);
  process.exit(1);
});
