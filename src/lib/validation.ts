/**
 * Validation Library — ground truth + scoring for LLM-in-the-loop tests.
 *
 * The compression pipeline's biggest open question is qualitative: "If the
 * LLM only sees the compressed view, can it still do real work?" This module
 * gives that question a quantitative answer.
 *
 * Three primitives:
 *
 *   buildGroundTruth(filePath)
 *     Reads the file with the full AST parser and returns the structured
 *     truth (exported symbols, imports, function signatures, type names).
 *
 *   scoreSymbolRecall(predictedSymbols, truthSymbols)
 *     0.0-1.0 — what fraction of the real exported symbols did the answer
 *     mention? Order-insensitive, case-insensitive, substring-tolerant.
 *
 *   scoreUsageCode(generatedCode, truthSymbols)
 *     0.0-1.0 — does the LLM's "write a file that uses this module" answer
 *     actually reference real exported symbols (not hallucinated names)?
 *
 *   scoreSpecificity(answerText, truthSymbols)
 *     0.0-1.0 — penalizes generic answers ("looks fine, no obvious leaks")
 *     by rewarding mentions of specific symbol names from the truth set.
 *
 * Why these specific scorers:
 *   - Recall covers "did the compression preserve enough surface area"
 *   - Usage covers "is the compressed view structurally sufficient to USE the code"
 *   - Specificity covers "is the answer drawn from the compressed view or vibes"
 *
 * Combined into a single 0-100 score with weights documented inline.
 */

import fs from "node:fs";
import {
  detectLanguage,
  extractSignatures,
  formatSignature,
} from "./astParser.js";
import { countTextTokens } from "./tokenCounter.js";
import type { FileSignature } from "../types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface GroundTruth {
  filePath: string;
  language: string;
  /** Full uncompressed file content. */
  rawSource: string;
  /** AST signature object (imports, exports, functions, classes). */
  signature: FileSignature;
  /** The compressed view that the LLM will be tested against. */
  compressedView: string;
  /** Flattened canonical set of exported symbol names. */
  exportedSymbols: string[];
  /** Token budgets. */
  tokens: {
    raw: number;
    compressed: number;
    savingsPercent: number;
  };
}

export interface ValidationPrompt {
  id: string;
  question: string;
  /** What dimension this prompt is testing. */
  scorer: "recall" | "usage" | "specificity";
  /** Hint to the LLM about the expected answer shape (kept short). */
  expectedShape: string;
}

export interface ValidationScore {
  /** Per-prompt scores in the same order as the prompts. */
  perPrompt: Array<{
    promptId: string;
    scorer: string;
    score: number;
    detail: string;
  }>;
  /** Aggregate score in [0, 100]. */
  aggregate: number;
  /** Verdict bucket — for quick human read. */
  verdict: "excellent" | "good" | "acceptable" | "lossy" | "broken";
  notes: string[];
}

// ─── Ground truth ───────────────────────────────────────────────────────────

/**
 * Build the ground-truth bundle for a single source file.
 *
 * `extractSignatures` is the same code path that gate_compress_file uses, so
 * the validation operates on the EXACT view the LLM would see — no risk of
 * scoring against a different compressor.
 */
export function buildGroundTruth(filePath: string): GroundTruth {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Ground-truth source not found: ${filePath}`);
  }
  const rawSource = fs.readFileSync(filePath, "utf8");
  const language = detectLanguage(filePath);
  const signature = extractSignatures(rawSource, language);
  const compressedView = formatSignature(signature, language);
  const exportedSymbols = canonicalExportNames(signature);
  const rawTokens = countTextTokens(rawSource);
  const compressedTokens = countTextTokens(compressedView);
  const savings =
    rawTokens > 0
      ? Math.round(((rawTokens - compressedTokens) / rawTokens) * 100)
      : 0;
  return {
    filePath,
    language,
    rawSource,
    signature,
    compressedView,
    exportedSymbols,
    tokens: {
      raw: rawTokens,
      compressed: compressedTokens,
      savingsPercent: savings,
    },
  };
}

/**
 * Reduce a FileSignature's exports array into a flat list of bare symbol
 * names. Strips the leading "export " keyword and any value/type qualifier.
 * Example: "export const foo = 1" -> "foo", "export class Foo {}" -> "Foo".
 *
 * Falls back to function/class names when exports are missing (CJS modules,
 * default-only exports).
 */
function canonicalExportNames(sig: FileSignature): string[] {
  const names = new Set<string>();
  for (const e of sig.exports) {
    const stripped = e
      .replace(/^export\s+(default\s+)?(async\s+)?/, "")
      .replace(/^(type|interface|const|let|var|function|class|enum|namespace)\s+/, "");
    const match = stripped.match(/^([A-Za-z_$][\w$]*)/);
    if (match) names.add(match[1]);
    // Also support "export { foo, bar }" patterns.
    const groupMatch = e.match(/export\s*\{\s*([^}]+)\}/);
    if (groupMatch) {
      for (const item of groupMatch[1].split(",")) {
        const cleaned = item
          .trim()
          .replace(/\s+as\s+\w+/, "")
          .match(/^([A-Za-z_$][\w$]*)/);
        if (cleaned) names.add(cleaned[1]);
      }
    }
  }
  // Augment with function + class definitions in case exports are sparse.
  for (const fn of sig.functions) {
    const m = fn.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
    if (m) names.add(m[1]);
  }
  for (const cls of sig.classes) {
    const m = cls.match(/^(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/);
    if (m) names.add(m[1]);
  }
  return Array.from(names).sort();
}

// ─── Prompt synthesis ───────────────────────────────────────────────────────

/**
 * Build the standard 4-prompt validation battery for a file. Same prompts
 * every time so historical scores are comparable.
 */
export function buildValidationPrompts(truth: GroundTruth): ValidationPrompt[] {
  return [
    {
      id: "p1-list-exports",
      scorer: "recall",
      question:
        "Given ONLY the compressed view above, list every public symbol exported from this module. " +
        "Reply with ONE symbol per line, no extra commentary.",
      expectedShape: `${truth.exportedSymbols.length} symbol names, one per line`,
    },
    {
      id: "p2-write-usage",
      scorer: "usage",
      question:
        "Given ONLY the compressed view above, write a fresh TypeScript file that imports from " +
        `"${truth.filePath}" and demonstrably uses at least 3 of its exports. ` +
        "Just the code, no prose.",
      expectedShape: "valid TS/JS code referencing 3+ real exported symbols",
    },
    {
      id: "p3-risk-audit",
      scorer: "specificity",
      question:
        "Audit this module for risks (memory leaks, missing error handling, " +
        "concurrency hazards). Reference SPECIFIC symbols from the compressed view " +
        "in your answer — do not give generic advice.",
      expectedShape: "answer mentioning at least 2 specific symbol names from the truth set",
    },
    {
      id: "p4-test-strategy",
      scorer: "specificity",
      question:
        "Propose a testing strategy for this module: name SPECIFIC functions or " +
        "classes that need tests and explain what each test should cover. Refer to " +
        "real names from the compressed view, not generic advice.",
      expectedShape: "answer mentioning at least 2 specific symbol names from the truth set",
    },
  ];
}

// ─── Scoring ────────────────────────────────────────────────────────────────

/**
 * Symbol-recall score: what fraction of the truth's exported symbols does
 * the predicted answer mention? Case-insensitive substring match. Empty
 * truth set scores 1.0 (no symbols to miss).
 */
export function scoreSymbolRecall(answer: string, truthSymbols: string[]): {
  score: number;
  matched: string[];
  missed: string[];
} {
  if (truthSymbols.length === 0) return { score: 1, matched: [], missed: [] };
  const lower = answer.toLowerCase();
  const matched: string[] = [];
  const missed: string[] = [];
  for (const sym of truthSymbols) {
    if (lower.includes(sym.toLowerCase())) {
      matched.push(sym);
    } else {
      missed.push(sym);
    }
  }
  return {
    score: matched.length / truthSymbols.length,
    matched,
    missed,
  };
}

/**
 * Usage-code score: parse the generated code's identifier references and
 * count how many resolve to real exported symbols. Requires at least one
 * import statement that includes the truth file (substring match), then
 * counts unique exported symbols referenced anywhere in the generated body.
 * Score is min(matched / 3, 1.0) — we asked for 3+ exports used.
 */
export function scoreUsageCode(
  generatedCode: string,
  truthSymbols: string[],
  truthFilePath: string
): {
  score: number;
  symbolsUsed: string[];
  importsTruthFile: boolean;
  invalidSymbols: string[];
} {
  if (truthSymbols.length === 0) {
    return {
      score: 0,
      symbolsUsed: [],
      importsTruthFile: false,
      invalidSymbols: [],
    };
  }
  // Detect import of the truth file. We match the file's basename without
  // extension so the LLM's relative path won't sabotage the check.
  const basename = truthFilePath
    .split("/")
    .pop()!
    .replace(/\.[^.]+$/, "");
  const importsTruthFile = new RegExp(
    `\\b(import|from|require)\\b[\\s\\S]*?["']([^"']*${escapeRegex(basename)}[^"']*)["']`,
    "i"
  ).test(generatedCode);

  // Identifier candidates from the generated code body.
  const identifiers = new Set<string>();
  const idRegex = /\b([A-Za-z_$][\w$]*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = idRegex.exec(generatedCode))) {
    identifiers.add(m[1]);
  }

  const truthSet = new Set(truthSymbols);
  const symbolsUsed: string[] = [];
  for (const id of identifiers) {
    if (truthSet.has(id)) symbolsUsed.push(id);
  }
  // We do NOT enumerate invalid identifiers as "wrong" — the answer is
  // allowed to reference local variables, language keywords, etc. The signal
  // we care about is "did the LLM reach for REAL exports".
  const invalidSymbols: string[] = [];

  const raw = symbolsUsed.length / 3;
  let score = Math.min(raw, 1);
  // Penalty if the import statement is missing — even correct symbols are
  // worthless if the file isn't referenced.
  if (!importsTruthFile) score *= 0.5;
  return { score, symbolsUsed, importsTruthFile, invalidSymbols };
}

/**
 * Specificity score: penalizes generic answers by rewarding the answer for
 * naming real symbols from the truth set. Score = min(distinctSymbols / 2, 1).
 * 2-symbol threshold matches the prompt's "at least 2 specific symbols"
 * instruction.
 */
export function scoreSpecificity(
  answer: string,
  truthSymbols: string[]
): { score: number; matched: string[] } {
  if (truthSymbols.length === 0) return { score: 0, matched: [] };
  const matched = new Set<string>();
  // Use word-boundary matching here — substring would over-count common
  // prefixes (e.g. "use" inside "useEffect" inside "useEffectAnyway").
  for (const sym of truthSymbols) {
    const re = new RegExp(`\\b${escapeRegex(sym)}\\b`);
    if (re.test(answer)) matched.add(sym);
  }
  return {
    score: Math.min(matched.size / 2, 1),
    matched: Array.from(matched),
  };
}

/**
 * Aggregate the per-prompt scores into a single 0-100 number plus a verdict
 * bucket. Weights are tuned to reflect what we care about most:
 *   - recall: 40 (most important — preserves the API surface)
 *   - usage:  35 (proves the compressed view is structurally usable)
 *   - specificity (avg of two specificity prompts): 25
 */
export function aggregateScores(
  results: Array<{ id: string; scorer: string; score: number }>
): ValidationScore {
  const recall = results.find((r) => r.scorer === "recall")?.score ?? 0;
  const usage = results.find((r) => r.scorer === "usage")?.score ?? 0;
  const specificityScores = results
    .filter((r) => r.scorer === "specificity")
    .map((r) => r.score);
  const specificity =
    specificityScores.length > 0
      ? specificityScores.reduce((a, b) => a + b, 0) / specificityScores.length
      : 0;

  const aggregate = Math.round(
    recall * 40 + usage * 35 + specificity * 25
  );

  let verdict: ValidationScore["verdict"];
  if (aggregate >= 90) verdict = "excellent";
  else if (aggregate >= 75) verdict = "good";
  else if (aggregate >= 60) verdict = "acceptable";
  else if (aggregate >= 30) verdict = "lossy";
  else verdict = "broken";

  const notes: string[] = [];
  if (recall < 0.7)
    notes.push(
      `Symbol recall is low (${Math.round(recall * 100)}%) — the compressor is dropping exports the LLM can no longer name.`
    );
  if (usage < 0.5)
    notes.push(
      `Usage-code score is low (${Math.round(usage * 100)}%) — the LLM can't construct a valid using-file from the compressed view.`
    );
  if (specificity < 0.5)
    notes.push(
      `Specificity is low (${Math.round(specificity * 100)}%) — answers stayed generic, suggesting the compressed view doesn't surface enough structure.`
    );
  if (aggregate >= 75 && notes.length === 0)
    notes.push("Compressed view preserves enough signal for real LLM work.");

  return {
    perPrompt: results.map((r) => ({
      promptId: r.id,
      scorer: r.scorer,
      score: r.score,
      detail: `${Math.round(r.score * 100)}%`,
    })),
    aggregate,
    verdict,
    notes,
  };
}

// ─── helpers ────────────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
