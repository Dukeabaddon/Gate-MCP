/**
 * LLM Provider abstraction for the validation loop.
 *
 * Three providers ship by default:
 *
 *   mock     — deterministic, no network. Always available. Used by CI tests
 *              so the validation tool has a regressable baseline that doesn't
 *              cost money or depend on a model server being up.
 *   ollama   — local Ollama HTTP server. Free, private, no API key. Default
 *              for power users who want a real LLM in the loop without
 *              paying.
 *   openai   — OpenAI / OpenAI-compatible HTTP endpoint. Requires
 *              OPENAI_API_KEY (and optional OPENAI_BASE_URL for OpenRouter,
 *              LiteLLM, etc.). Used when the user wants frontier-grade
 *              answers for a high-stakes evaluation.
 *
 * The mock provider's job is NOT to fake a real LLM well — it's to produce
 * outputs that exercise each scorer's full code path so we can detect
 * scoring regressions independent of any real model.
 */

import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import logger from "./logger.js";
import type { GroundTruth, ValidationPrompt } from "./validation.js";

export type LlmProviderName = "mock" | "ollama" | "openai";

export interface LlmAnswer {
  promptId: string;
  text: string;
  latencyMs: number;
  /** Provider-specific metadata for debugging. */
  meta?: Record<string, unknown>;
}

export interface LlmProvider {
  name: LlmProviderName;
  /** Convenience tag for the score report ("ollama:llama3:8b", "mock", etc.). */
  describe(): string;
  answer(
    prompt: ValidationPrompt,
    truth: GroundTruth
  ): Promise<LlmAnswer>;
}

// ─── Mock provider ──────────────────────────────────────────────────────────

/**
 * Deterministic mock — produces answers that look like a "perfect"
 * compressed-view-aware response. Used for CI / regression testing of the
 * scoring code itself.
 */
export class MockProvider implements LlmProvider {
  name: LlmProviderName = "mock";
  private faulty: boolean;
  constructor(opts: { faulty?: boolean } = {}) {
    this.faulty = opts.faulty ?? false;
  }
  describe(): string {
    return this.faulty ? "mock-faulty" : "mock-perfect";
  }
  async answer(
    prompt: ValidationPrompt,
    truth: GroundTruth
  ): Promise<LlmAnswer> {
    const startedAt = Date.now();
    let text: string;
    switch (prompt.scorer) {
      case "recall":
        // Perfect mock: list every truth symbol; faulty mock: list half.
        text = this.faulty
          ? truth.exportedSymbols.slice(0, Math.ceil(truth.exportedSymbols.length / 2)).join("\n")
          : truth.exportedSymbols.join("\n");
        break;
      case "usage": {
        const slice = truth.exportedSymbols.slice(0, 3);
        if (this.faulty || slice.length === 0) {
          text = "// faulty mock — does not import the truth file\nconsole.log('hello');";
        } else {
          text =
            `import { ${slice.join(", ")} } from "./${truth.filePath
              .split("/")
              .pop()!
              .replace(/\.[^.]+$/, "")}";\n` +
            slice.map((s) => `void ${s};`).join("\n");
        }
        break;
      }
      case "specificity":
        // Perfect mock mentions 3 specific symbols; faulty stays generic.
        if (this.faulty) {
          text = "Looks fine overall, no obvious issues. Standard testing applies.";
        } else {
          const named = truth.exportedSymbols.slice(0, 3).join(", ") || "the module";
          text = `Audit notes: ${named} should be tested for boundary inputs and concurrency.`;
        }
        break;
      default:
        text = "";
    }
    return {
      promptId: prompt.id,
      text,
      latencyMs: Date.now() - startedAt,
      meta: { mockFaulty: this.faulty },
    };
  }
}

// ─── Ollama provider ────────────────────────────────────────────────────────

/**
 * Talks to a local Ollama server (default http://localhost:11434).
 * Free, no API key. Pass `model` to pick a specific local model
 * (default: qwen2.5-coder:7b or whatever the user has pulled).
 */
export class OllamaProvider implements LlmProvider {
  name: LlmProviderName = "ollama";
  private baseUrl: string;
  private model: string;
  constructor(opts: { baseUrl?: string; model?: string } = {}) {
    this.baseUrl =
      opts.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
    this.model = opts.model ?? process.env.OLLAMA_MODEL ?? "qwen2.5-coder:7b";
  }
  describe(): string {
    return `ollama:${this.model}`;
  }
  async answer(
    prompt: ValidationPrompt,
    truth: GroundTruth
  ): Promise<LlmAnswer> {
    const startedAt = Date.now();
    const body = JSON.stringify({
      model: this.model,
      prompt: composePrompt(prompt, truth),
      stream: false,
      options: { temperature: 0 },
    });
    const raw = await postJson(
      `${this.baseUrl}/api/generate`,
      body,
      120_000
    );
    let text = "";
    try {
      const parsed = JSON.parse(raw) as { response?: string };
      text = parsed.response ?? "";
    } catch (err) {
      logger.warn(`[llm:ollama] failed to parse Ollama response: ${err}`);
      text = raw;
    }
    return {
      promptId: prompt.id,
      text,
      latencyMs: Date.now() - startedAt,
      meta: { model: this.model },
    };
  }
}

// ─── OpenAI / OpenAI-compatible provider ────────────────────────────────────

/**
 * Talks to OpenAI's chat completions API (or any OpenAI-compatible endpoint
 * via OPENAI_BASE_URL — works with OpenRouter, LiteLLM, vLLM, etc.).
 */
export class OpenAiProvider implements LlmProvider {
  name: LlmProviderName = "openai";
  private baseUrl: string;
  private model: string;
  private apiKey: string;
  constructor(opts: { baseUrl?: string; model?: string; apiKey?: string } = {}) {
    this.baseUrl =
      opts.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    this.model = opts.model ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";
    this.apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    if (!this.apiKey) {
      throw new Error(
        "OpenAI provider requires OPENAI_API_KEY env var (or apiKey constructor arg)"
      );
    }
  }
  describe(): string {
    return `openai:${this.model}`;
  }
  async answer(
    prompt: ValidationPrompt,
    truth: GroundTruth
  ): Promise<LlmAnswer> {
    const startedAt = Date.now();
    const body = JSON.stringify({
      model: this.model,
      messages: [
        {
          role: "system",
          content:
            "You answer based ONLY on the provided compressed view. Do not invent symbol names.",
        },
        {
          role: "user",
          content: composePrompt(prompt, truth),
        },
      ],
      temperature: 0,
    });
    const raw = await postJson(
      `${this.baseUrl}/chat/completions`,
      body,
      120_000,
      { Authorization: `Bearer ${this.apiKey}` }
    );
    let text = "";
    try {
      const parsed = JSON.parse(raw) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      text = parsed.choices?.[0]?.message?.content ?? "";
    } catch (err) {
      logger.warn(`[llm:openai] failed to parse response: ${err}`);
      text = raw;
    }
    return {
      promptId: prompt.id,
      text,
      latencyMs: Date.now() - startedAt,
      meta: { model: this.model },
    };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function composePrompt(prompt: ValidationPrompt, truth: GroundTruth): string {
  return [
    `File: ${truth.filePath}`,
    `Language: ${truth.language}`,
    "",
    "─── COMPRESSED VIEW START ───",
    truth.compressedView,
    "─── COMPRESSED VIEW END ───",
    "",
    `Task: ${prompt.question}`,
    "",
    `(Reply with: ${prompt.expectedShape})`,
  ].join("\n");
}

function postJson(
  url: string,
  body: string,
  timeoutMs: number,
  extraHeaders: Record<string, string> = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          ...extraHeaders,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const responseBody = Buffer.concat(chunks).toString("utf8");
          if (!res.statusCode || res.statusCode >= 400) {
            reject(
              new Error(
                `HTTP ${res.statusCode} from ${url}: ${responseBody.slice(0, 200)}`
              )
            );
            return;
          }
          resolve(responseBody);
        });
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error(`POST ${url} timed out after ${timeoutMs}ms`));
    });
    req.on("error", (err) => reject(err));
    req.write(body);
    req.end();
  });
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function createProvider(name: LlmProviderName, opts: Record<string, unknown> = {}): LlmProvider {
  switch (name) {
    case "mock":
      return new MockProvider({ faulty: opts.faulty === true });
    case "ollama":
      return new OllamaProvider({
        baseUrl: opts.baseUrl as string | undefined,
        model: opts.model as string | undefined,
      });
    case "openai":
      return new OpenAiProvider({
        baseUrl: opts.baseUrl as string | undefined,
        model: opts.model as string | undefined,
        apiKey: opts.apiKey as string | undefined,
      });
    default:
      throw new Error(`Unknown LLM provider: ${name}`);
  }
}
