/**
 * gate_validate_compression — productionized Experiment #4b.
 *
 * Runs the LLM-in-the-loop validation battery against a single source file
 * and returns a 0-100 score that measures whether the compressed view
 * preserves enough signal for an LLM to do real work (list exports, write
 * using-code, audit, propose tests).
 *
 * Three modes:
 *
 *   mode='prompts'  — generate prompts only (no LLM call). For tooling that
 *                     wants to drive its own LLM and submit responses back.
 *
 *   mode='score'    — accept user-supplied LLM responses and score them. Used
 *                     by external pipelines (CI workflows, Cursor's own LLM,
 *                     etc.) to avoid burning API budget inside gatemcp.
 *
 *   mode='run'      — call the configured provider (mock|ollama|openai), get
 *                     answers, score them, and return everything in one shot.
 *
 * Default provider is "mock" so the tool is safe to call without an API key.
 * Switching to ollama or openai is opt-in via the `provider` arg.
 */

import {
  buildGroundTruth,
  buildValidationPrompts,
  scoreSymbolRecall,
  scoreUsageCode,
  scoreSpecificity,
  aggregateScores,
  type GroundTruth,
  type ValidationPrompt,
  type ValidationScore,
} from "../lib/validation.js";
import {
  createProvider,
  type LlmProviderName,
  type LlmAnswer,
} from "../lib/llmProvider.js";
import { safeResolveExistingFile } from "../lib/pathGuard.js";
import logger from "../lib/logger.js";

// ─── Input / output types ───────────────────────────────────────────────────

export interface ValidateCompressionInput {
  filePath: string;
  mode?: "prompts" | "score" | "run";
  /** When mode='score', the LLM responses keyed by prompt id. */
  responses?: Record<string, string>;
  /** When mode='run', which provider to use. Default 'mock'. */
  provider?: LlmProviderName;
  /** Provider-specific options (model, baseUrl, etc.). */
  providerOpts?: Record<string, unknown>;
  /** When true, omit the raw source from the response (LLMs don't need it). */
  omitRawSource?: boolean;
  projectRoot?: string;
}

export interface ValidateCompressionResult {
  mode: "prompts" | "score" | "run";
  filePath: string;
  language: string;
  tokens: {
    raw: number;
    compressed: number;
    savingsPercent: number;
  };
  compressedView: string;
  exportedSymbols: string[];
  prompts: ValidationPrompt[];
  /** Populated for mode='score' and mode='run'. */
  answers?: Array<LlmAnswer>;
  /** Populated for mode='score' and mode='run'. */
  score?: ValidationScore;
  /** Populated for mode='run' — describes which provider was used. */
  providerDescription?: string;
  note: string;
}

// ─── Handler ────────────────────────────────────────────────────────────────

export async function handleValidateCompression(
  args: ValidateCompressionInput
): Promise<ValidateCompressionResult> {
  const {
    filePath,
    mode = "run",
    responses,
    provider = "mock",
    providerOpts = {},
    omitRawSource = true,
    projectRoot,
  } = args;

  if (!filePath) {
    throw new Error("gate_validate_compression requires filePath");
  }
  const resolved = safeResolveExistingFile(filePath, { projectRoot });
  const truth = buildGroundTruth(resolved);
  const prompts = buildValidationPrompts(truth);

  const base: ValidateCompressionResult = {
    mode,
    filePath: truth.filePath,
    language: truth.language,
    tokens: truth.tokens,
    compressedView: truth.compressedView,
    exportedSymbols: truth.exportedSymbols,
    prompts,
    note: "",
  };

  if (mode === "prompts") {
    base.note =
      `Generated ${prompts.length} validation prompts for ${truth.filePath}. ` +
      `Run them through any LLM and resubmit with mode='score' + responses dict.`;
    if (!omitRawSource) {
      // Intentionally not exposing rawSource in the response shape — the
      // compressed view IS what we're validating, so handing the raw source
      // back would invite the caller to cheat.
    }
    return base;
  }

  if (mode === "score") {
    if (!responses) {
      throw new Error("mode='score' requires a 'responses' dict keyed by prompt id");
    }
    const answers: LlmAnswer[] = prompts.map((p) => ({
      promptId: p.id,
      text: responses[p.id] ?? "",
      latencyMs: 0,
      meta: { externallyProvided: true },
    }));
    base.answers = answers;
    base.score = scoreAnswers(truth, prompts, answers);
    base.note = describeNote(truth, base.score);
    return base;
  }

  // mode === "run"
  const provInstance = createProvider(provider, providerOpts);
  base.providerDescription = provInstance.describe();
  const answers: LlmAnswer[] = [];
  for (const prompt of prompts) {
    try {
      const ans = await provInstance.answer(prompt, truth);
      answers.push(ans);
    } catch (err) {
      logger.warn(
        `[validate] provider ${provInstance.describe()} failed on ${prompt.id}: ${err}`
      );
      answers.push({
        promptId: prompt.id,
        text: "",
        latencyMs: 0,
        meta: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }
  base.answers = answers;
  base.score = scoreAnswers(truth, prompts, answers);
  base.note = describeNote(truth, base.score, provInstance.describe());
  return base;
}

function scoreAnswers(
  truth: GroundTruth,
  prompts: ValidationPrompt[],
  answers: LlmAnswer[]
): ValidationScore {
  const ansById = new Map(answers.map((a) => [a.promptId, a.text]));
  const results = prompts.map((p) => {
    const answer = ansById.get(p.id) ?? "";
    let score = 0;
    switch (p.scorer) {
      case "recall":
        score = scoreSymbolRecall(answer, truth.exportedSymbols).score;
        break;
      case "usage":
        score = scoreUsageCode(answer, truth.exportedSymbols, truth.filePath).score;
        break;
      case "specificity":
        score = scoreSpecificity(answer, truth.exportedSymbols).score;
        break;
    }
    return { id: p.id, scorer: p.scorer, score };
  });
  return aggregateScores(results);
}

function describeNote(
  truth: GroundTruth,
  score: ValidationScore,
  providerLabel?: string
): string {
  const provider = providerLabel ? ` via ${providerLabel}` : "";
  const tokens = `${truth.tokens.raw}→${truth.tokens.compressed} tokens (${truth.tokens.savingsPercent}% saved)`;
  return (
    `validate_compression${provider}: ${score.aggregate}/100 (${score.verdict}). ` +
    `${tokens}. ${score.notes.join(" ")}`
  );
}
