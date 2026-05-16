#!/usr/bin/env node
/**
 * gatemcp v0.6.0 — LLM-in-the-loop validation CLI.
 *
 * Drives gate_validate_compression end-to-end against a single source file
 * with whichever provider you choose. Designed for power users who want to
 * (a) verify a real LLM accepts the compressed view, or (b) benchmark
 * different models against the same compressed input.
 *
 * Usage:
 *   node dist/scripts/validate-llm.js <file> [--provider mock|ollama|openai]
 *                                            [--model <model-name>]
 *                                            [--base-url <url>]
 *                                            [--json]
 *
 * Examples:
 *   # Run with the deterministic mock (CI-friendly, no API key)
 *   node dist/scripts/validate-llm.js src/main.ts
 *
 *   # Run against a local Ollama (free, private)
 *   node dist/scripts/validate-llm.js src/main.ts --provider ollama --model qwen2.5-coder:7b
 *
 *   # Run against OpenAI (needs OPENAI_API_KEY)
 *   node dist/scripts/validate-llm.js src/main.ts --provider openai --model gpt-4o-mini
 */

import os from "node:os";
import path from "node:path";
import { handleValidateCompression } from "../tools/validateCompression.js";
import type { LlmProviderName } from "../lib/llmProvider.js";

interface CliFlags {
  file: string;
  provider: LlmProviderName;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  json: boolean;
  faulty: boolean;
}

function parseArgs(): CliFlags {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0].startsWith("--")) {
    printUsage();
    process.exit(args.includes("--help") || args.includes("-h") ? 0 : 1);
  }
  const flags: CliFlags = {
    file: args[0],
    provider: "mock",
    json: false,
    faulty: false,
  };
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--provider":
        flags.provider = args[++i] as LlmProviderName;
        break;
      case "--model":
        flags.model = args[++i];
        break;
      case "--base-url":
        flags.baseUrl = args[++i];
        break;
      case "--api-key":
        flags.apiKey = args[++i];
        break;
      case "--json":
        flags.json = true;
        break;
      case "--faulty":
        flags.faulty = true;
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
      default:
        console.error(`Unknown flag: ${arg}`);
        printUsage();
        process.exit(1);
    }
  }
  if (!flags.provider || !["mock", "ollama", "openai"].includes(flags.provider)) {
    console.error(`Invalid provider: ${flags.provider}`);
    printUsage();
    process.exit(1);
  }
  return flags;
}

function printUsage(): void {
  console.error(
    `Usage: validate-llm <file> [--provider mock|ollama|openai] [--model <name>]\n` +
      `                          [--base-url <url>] [--api-key <key>] [--json] [--faulty]\n` +
      `\n` +
      `Defaults: --provider mock\n` +
      `\n` +
      `Env overrides:\n` +
      `  OLLAMA_BASE_URL  default http://localhost:11434\n` +
      `  OLLAMA_MODEL     default qwen2.5-coder:7b\n` +
      `  OPENAI_API_KEY   required for --provider openai\n` +
      `  OPENAI_BASE_URL  default https://api.openai.com/v1\n` +
      `  OPENAI_MODEL     default gpt-4o-mini\n`
  );
}

function expandHome(p: string): string {
  if (p.startsWith("~")) return path.join(os.homedir(), p.slice(1));
  return p;
}

async function main(): Promise<void> {
  const flags = parseArgs();
  const filePath = path.resolve(expandHome(flags.file));

  const providerOpts: Record<string, unknown> = {};
  if (flags.model) providerOpts.model = flags.model;
  if (flags.baseUrl) providerOpts.baseUrl = flags.baseUrl;
  if (flags.apiKey) providerOpts.apiKey = flags.apiKey;
  if (flags.faulty) providerOpts.faulty = true;

  const result = await handleValidateCompression({
    filePath,
    mode: "run",
    provider: flags.provider,
    providerOpts,
  });

  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.score && result.score.aggregate >= 60 ? 0 : 1);
  }

  // Pretty human-readable report
  const score = result.score!;
  console.log("");
  console.log(`File:     ${result.filePath}`);
  console.log(`Language: ${result.language}`);
  console.log(`Provider: ${result.providerDescription}`);
  console.log(
    `Tokens:   ${result.tokens.raw} -> ${result.tokens.compressed} (${result.tokens.savingsPercent}% saved)`
  );
  console.log("");
  console.log("┌──────────────────────┬─────────┬───────────────────────────────┐");
  console.log("│ Prompt               │ Score   │ Scorer                        │");
  console.log("├──────────────────────┼─────────┼───────────────────────────────┤");
  for (const p of score.perPrompt) {
    const id = p.promptId.padEnd(20);
    const pct = String(Math.round(p.score * 100) + "%").padStart(7);
    const sc = p.scorer.padEnd(29);
    console.log(`│ ${id} │ ${pct} │ ${sc} │`);
  }
  console.log("└──────────────────────┴─────────┴───────────────────────────────┘");
  console.log("");
  console.log(`Aggregate: ${score.aggregate}/100  (${score.verdict.toUpperCase()})`);
  if (score.notes.length) {
    console.log("");
    console.log("Notes:");
    for (const n of score.notes) console.log(`  • ${n}`);
  }
  // Exit non-zero for lossy or broken so CI catches regressions
  process.exit(score.aggregate >= 60 ? 0 : 1);
}

main().catch((err) => {
  console.error(`Fatal: ${err}`);
  process.exit(2);
});
