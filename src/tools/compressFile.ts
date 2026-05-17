/**
 * gate_compress_file tool implementation.
 *
 * Reduces file input tokens by returning AST signatures,
 * structure (YAML/MD keys), summaries, or full content.
 */

import fs from "node:fs";
import {
  detectLanguage,
  extractSignatures,
  formatSignature,
} from "../lib/astParser.js";
import {
  countTextTokens,
  calculateSavings,
  formatSavingsNote,
} from "../lib/tokenCounter.js";
import { safeResolveExistingFile } from "../lib/pathGuard.js";
import logger from "../lib/logger.js";
import type { CompressionDepth, CompressFileResult } from "../types.js";
import { checkCache, storeInCache } from "./dedupContext.js";

/** Languages where AST signature/summary often inflates token count. */
const STRUCTURE_ONLY_LANGS = new Set(["yaml", "markdown", "json", "unknown"]);

function usesStructureOnly(language: string, depth: CompressionDepth): boolean {
  if (depth === "structure") return true;
  if (STRUCTURE_ONLY_LANGS.has(language) && depth !== "full") return true;
  return false;
}

function cacheHitResult(
  cached: NonNullable<ReturnType<typeof checkCache>>,
  depth: CompressionDepth
): CompressFileResult {
  const metrics = calculateSavings(cached.originalTokens, cached.tokens);
  const savedThisHit = Math.max(0, cached.originalTokens - cached.tokens);
  const savedNote =
    metrics.expanded || savedThisHit === 0
      ? `Cache hit #${cached.hitCount}; cached view is not smaller than raw file.`
      : `Cache hit #${cached.hitCount}; saved ~${savedThisHit} tokens vs re-reading.`;

  return {
    type: depth === "structure" ? "structure" : (depth as "signature" | "summary"),
    content: cached.content,
    language: "cached",
    originalTokens: cached.originalTokens,
    optimizedTokens: cached.tokens,
    savingsPercent: metrics.savingsPercent,
    expanded: metrics.expanded,
    note: `[DEDUP] File unchanged (hash: ${cached.hash}). ${savedNote}`,
  };
}

export async function handleCompressFile(args: {
  filePath: string;
  depth?: CompressionDepth;
}): Promise<CompressFileResult> {
  const { depth = "signature" } = args;

  const filePath = safeResolveExistingFile(args.filePath, {
    caller: "gate_compress_file",
  });

  logger.info(`Compressing file: ${filePath} (depth=${depth})`);

  if (depth === "signature" || depth === "summary" || depth === "structure") {
    const cached = checkCache(filePath);
    if (cached) return cacheHitResult(cached, depth);
  }

  const fullContent = fs.readFileSync(filePath, "utf-8");
  const originalTokens = countTextTokens(fullContent);
  const language = detectLanguage(filePath);

  logger.debug(`Language: ${language}, original tokens: ${originalTokens}`);

  switch (depth) {
    case "structure": {
      const result = processStructure(fullContent, language, originalTokens);
      storeInCache(filePath, result.content, originalTokens);
      return result;
    }
    case "signature": {
      const result = usesStructureOnly(language, depth)
        ? processStructure(fullContent, language, originalTokens)
        : processSignature(fullContent, language, originalTokens);
      storeInCache(filePath, result.content, originalTokens);
      return result;
    }
    case "summary": {
      if (STRUCTURE_ONLY_LANGS.has(language)) {
        const result = processStructure(
          fullContent,
          language,
          originalTokens,
          "summary not ideal for this format; using structure (keys/headings only)."
        );
        storeInCache(filePath, result.content, originalTokens);
        return result;
      }
      const result = processSummary(fullContent, language, originalTokens);
      storeInCache(filePath, result.content, originalTokens);
      return result;
    }
    case "full":
      return processFull(fullContent, language, originalTokens);
    default: {
      const result = processSignature(fullContent, language, originalTokens);
      storeInCache(filePath, result.content, originalTokens);
      return result;
    }
  }
}

function processStructure(
  source: string,
  language: string,
  originalTokens: number,
  extraNote?: string
): CompressFileResult {
  const sig = extractSignatures(source, language as Parameters<typeof extractSignatures>[1]);
  let content = formatSignature(sig, language);
  let lines = content.split("\n");
  const maxLines = 120;
  if (lines.length > maxLines) {
    lines = [
      ...lines.slice(0, maxLines),
      `// ... ${lines.length - maxLines} more structure lines truncated`,
    ];
    content = lines.join("\n");
  }

  let optimizedTokens = countTextTokens(content);
  let metrics = calculateSavings(originalTokens, optimizedTokens);

  if (metrics.expanded && lines.length > 40) {
    content = lines.slice(0, 40).join("\n") + "\n// ... structure truncated (expanded guard)";
    optimizedTokens = countTextTokens(content);
    metrics = calculateSavings(originalTokens, optimizedTokens);
  }

  const counts = [
    sig.imports.length > 0 ? `${sig.imports.length} imports` : "",
    sig.classes.length > 0 ? `${sig.classes.length} keys/headings` : "",
    sig.functions.length > 0 ? `${sig.functions.length} functions` : "",
    sig.exports.length > 0 ? `${sig.exports.length} exports` : "",
  ].filter(Boolean);

  const detail =
    (extraNote ? `${extraNote} ` : "") +
    `Structure-only view for ${language} (${counts.join(", ") || "outline"}).`;

  return {
    type: "structure",
    content,
    language,
    originalTokens: metrics.originalTokens,
    optimizedTokens: metrics.optimizedTokens,
    savingsPercent: metrics.savingsPercent,
    expanded: metrics.expanded,
    note: formatSavingsNote(metrics, detail),
  };
}

function processSignature(
  source: string,
  language: string,
  originalTokens: number
): CompressFileResult {
  const sig = extractSignatures(source, language as Parameters<typeof extractSignatures>[1]);
  const content = formatSignature(sig, language);
  const metrics = calculateSavings(originalTokens, countTextTokens(content));

  const counts = [
    sig.imports.length > 0 ? `${sig.imports.length} imports` : "",
    sig.classes.length > 0 ? `${sig.classes.length} classes` : "",
    sig.functions.length > 0 ? `${sig.functions.length} functions` : "",
    sig.exports.length > 0 ? `${sig.exports.length} exports` : "",
  ].filter(Boolean);

  return {
    type: "signature",
    content,
    language,
    originalTokens: metrics.originalTokens,
    optimizedTokens: metrics.optimizedTokens,
    savingsPercent: metrics.savingsPercent,
    expanded: metrics.expanded,
    note: formatSavingsNote(
      metrics,
      `Extracted ${counts.join(", ") || "structural signatures"} from ${language} file.`
    ),
  };
}

function processSummary(
  source: string,
  language: string,
  originalTokens: number
): CompressFileResult {
  const lines = source.split("\n");
  const parts: string[] = [];

  const head = lines.slice(0, 50);
  parts.push("// ─── First 50 lines ───");
  parts.push(...head);

  const sig = extractSignatures(source, language as Parameters<typeof extractSignatures>[1]);
  const sigBlock = formatSignature(sig, language);
  parts.push("");
  parts.push("// ─── Signatures ───");
  parts.push(sigBlock);

  if (lines.length > 70) {
    const tail = lines.slice(-20);
    parts.push("");
    parts.push("// ─── Last 20 lines ───");
    parts.push(...tail);
  }

  const content = parts.join("\n");
  const metrics = calculateSavings(originalTokens, countTextTokens(content));

  return {
    type: "summary",
    content,
    language,
    originalTokens: metrics.originalTokens,
    optimizedTokens: metrics.optimizedTokens,
    savingsPercent: metrics.savingsPercent,
    expanded: metrics.expanded,
    note: formatSavingsNote(
      metrics,
      `Summary: first 50 lines + signatures + last 20 lines (${lines.length} total lines).`
    ),
  };
}

function processFull(
  source: string,
  language: string,
  originalTokens: number
): CompressFileResult {
  return {
    type: "full",
    content: source,
    language,
    originalTokens,
    optimizedTokens: originalTokens,
    savingsPercent: 0,
    expanded: false,
    note: "Full file content returned (no compression applied).",
  };
}
