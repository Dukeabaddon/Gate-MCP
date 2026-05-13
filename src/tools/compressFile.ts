/**
 * gate_compress_file tool implementation.
 *
 * Reduces file input tokens by returning AST signatures,
 * summaries, or full content based on depth parameter.
 */

import fs from "node:fs";
import path from "node:path";
import {
  detectLanguage,
  extractSignatures,
  formatSignature,
} from "../lib/astParser.js";
import { countTextTokens, calculateSavings } from "../lib/tokenCounter.js";
import logger from "../lib/logger.js";
import type { CompressionDepth, CompressFileResult } from "../types.js";
import { checkCache, storeInCache } from "./dedupContext.js";

export async function handleCompressFile(args: {
  filePath: string;
  depth?: CompressionDepth;
}): Promise<CompressFileResult> {
  const { depth = "signature" } = args;

  // 1. Resolve and validate path
  const filePath = path.isAbsolute(args.filePath)
    ? args.filePath
    : path.resolve(process.cwd(), args.filePath);

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    throw new Error(`Path is a directory, not a file: ${filePath}`);
  }

  logger.info(`Compressing file: ${filePath} (depth=${depth})`);

  // 2. Check session dedup cache (provider caching equivalent)
  if (depth === "signature" || depth === "summary") {
    const cached = checkCache(filePath);
    if (cached) {
      const stubNote = `[DEDUP] Cache hit #${cached.hitCount}. File unchanged (hash: ${cached.hash}). Returning cached ${cached.type} content. This saved ${cached.originalTokens - cached.tokens} tokens vs re-reading.`;
      return {
        type: depth as "signature" | "summary",
        content: cached.content,
        language: "cached",
        originalTokens: cached.originalTokens,
        optimizedTokens: cached.tokens,
        savingsPercent: Math.round(
          ((cached.originalTokens - cached.tokens) / cached.originalTokens) * 100
        ),
        note: stubNote,
      };
    }
  }

  // 3. Read file content
  const fullContent = fs.readFileSync(filePath, "utf-8");
  const originalTokens = countTextTokens(fullContent);
  const language = detectLanguage(filePath);

  logger.debug(`Language: ${language}, original tokens: ${originalTokens}`);

  // 3. Process based on depth
  switch (depth) {
    case "signature": {
      const sigResult = processSignature(fullContent, language, originalTokens);
      storeInCache(filePath, sigResult.content, originalTokens);
      return sigResult;
    }
    case "summary": {
      const sumResult = processSummary(fullContent, language, originalTokens);
      storeInCache(filePath, sumResult.content, originalTokens);
      return sumResult;
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

function processSignature(
  source: string,
  language: string,
  originalTokens: number
): CompressFileResult {
  const lang = language as any;
  const sig = extractSignatures(source, lang);
  const content = formatSignature(sig, language);
  const optimizedTokens = countTextTokens(content);
  const savings = calculateSavings(originalTokens, optimizedTokens);

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
    originalTokens: savings.originalTokens,
    optimizedTokens: savings.optimizedTokens,
    savingsPercent: savings.savingsPercent,
    note: `Extracted ${counts.join(", ") || "structural signatures"} from ${language} file.`,
  };
}

function processSummary(
  source: string,
  language: string,
  originalTokens: number
): CompressFileResult {
  const lines = source.split("\n");
  const parts: string[] = [];

  // First 50 lines
  const head = lines.slice(0, 50);
  parts.push("// ─── First 50 lines ───");
  parts.push(...head);

  // Signatures
  const sig = extractSignatures(source, language as any);
  const sigBlock = formatSignature(sig, language);
  parts.push("");
  parts.push("// ─── Signatures ───");
  parts.push(sigBlock);

  // Last 20 lines
  if (lines.length > 70) {
    const tail = lines.slice(-20);
    parts.push("");
    parts.push("// ─── Last 20 lines ───");
    parts.push(...tail);
  }

  const content = parts.join("\n");
  const optimizedTokens = countTextTokens(content);
  const savings = calculateSavings(originalTokens, optimizedTokens);

  return {
    type: "summary",
    content,
    language,
    originalTokens: savings.originalTokens,
    optimizedTokens: savings.optimizedTokens,
    savingsPercent: savings.savingsPercent,
    note: `Summary: first 50 lines + signatures + last 20 lines (${lines.length} total lines).`,
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
    note: "Full file content returned (no compression applied).",
  };
}
