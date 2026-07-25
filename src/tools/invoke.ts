/**
 * gate_invoke — catalog-mode dispatcher for tools not in the small tools/list.
 * Args are validated with the same Zod schemas as direct MCP registration.
 */

import { handleOptimizeImage } from "./optimizeImage.js";
import { handleCompressFile } from "./compressFile.js";
import { handleGraphQuery } from "./graphQuery.js";
import { handleMemory } from "./memory.js";
import { handleDedupContext } from "./dedupContext.js";
import { handleCleanResponse } from "./cleanResponse.js";
import { handleProxyTools, handleProxyCall } from "./proxyTools.js";
import { handleValidateCompression } from "./validateCompression.js";
import { handleSessionStats } from "./sessionStats.js";
import { handleGateInit } from "./gateInit.js";
import { handleHelp } from "./help.js";
import { ALL_GATE_TOOLS, type GateToolName } from "../lib/toolMode.js";
import { TOOL_ARG_SCHEMAS } from "../lib/toolSchemas.js";
import type { z } from "zod";

export interface InvokeInput {
  tool: string;
  args?: Record<string, unknown>;
}

export interface InvokeResult {
  tool: string;
  result: unknown;
  note: string;
}

type HandlerMap = {
  [K in GateToolName]: (
    args: z.infer<(typeof TOOL_ARG_SCHEMAS)[K]>
  ) => Promise<unknown> | unknown;
};

const HANDLERS: HandlerMap = {
  gate_optimize_image: (a) =>
    handleOptimizeImage({
      imagePath: a.imagePath,
      intent: a.intent,
    }),
  gate_compress_file: (a) =>
    handleCompressFile({
      filePath: a.filePath,
      depth: a.depth,
      projectRoot: a.projectRoot,
    }),
  gate_graph_query: (a) =>
    handleGraphQuery({
      query: a.query,
      projectRoot: a.projectRoot,
      queryType: a.queryType,
      rebuild: a.rebuild,
      tokenBudget: a.tokenBudget,
    }),
  gate_memory: (a) =>
    handleMemory({
      action: a.action,
      key: a.key,
      value: a.value,
      projectRoot: a.projectRoot,
    }),
  gate_dedup_context: (a) =>
    handleDedupContext({
      action: a.action,
      filePath: a.filePath,
      content: a.content,
      originalTokens: a.originalTokens,
      projectRoot: a.projectRoot,
    }),
  gate_clean_response: (a) =>
    handleCleanResponse({
      data: a.data,
      format: a.format,
      whitelist: a.whitelist,
      maxArrayItems: a.maxArrayItems,
    }),
  gate_proxy_tools: (a) =>
    handleProxyTools({
      action: a.action,
      server: a.server,
      tool: a.tool,
      maxPerServer: a.maxPerServer,
      projectRoot: a.projectRoot,
    }),
  gate_proxy_call: (a) =>
    handleProxyCall({
      server: a.server,
      tool: a.tool,
      args: a.args as Record<string, unknown> | undefined,
      format: a.format,
      whitelist: a.whitelist,
      maxArrayItems: a.maxArrayItems,
      projectRoot: a.projectRoot,
      timeoutMs: a.timeoutMs,
    }),
  gate_validate_compression: (a) =>
    handleValidateCompression({
      filePath: a.filePath,
      mode: a.mode,
      responses: a.responses,
      provider: a.provider,
      providerOpts: a.providerOpts as Record<string, unknown> | undefined,
      projectRoot: a.projectRoot,
    }),
  gate_init: (a) => handleGateInit({ projectRoot: a.projectRoot }),
  gate_session_stats: (a) =>
    handleSessionStats({ projectRoot: a.projectRoot }),
  gate_help: (a) => handleHelp({ tool: a.tool }),
};

function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((issue) => {
      const path = issue.path.length ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export async function handleInvoke(input: InvokeInput): Promise<InvokeResult> {
  const tool = String(input.tool ?? "").trim();
  if (!tool) {
    throw new Error("gate_invoke requires tool");
  }
  if (tool === "gate_invoke") {
    throw new Error("gate_invoke cannot invoke itself");
  }
  if (!(ALL_GATE_TOOLS as readonly string[]).includes(tool)) {
    throw new Error(
      `Unknown tool '${tool}'. Allowed: ${ALL_GATE_TOOLS.join(", ")}`
    );
  }
  const name = tool as GateToolName;
  const schema = TOOL_ARG_SCHEMAS[name];
  const parsed = schema.safeParse(input.args ?? {});
  if (!parsed.success) {
    throw new Error(
      `Invalid args for ${name}: ${formatZodError(parsed.error)}`
    );
  }
  const handler = HANDLERS[name] as (
    args: unknown
  ) => Promise<unknown> | unknown;
  const result = await handler(parsed.data);
  return {
    tool,
    result,
    note: "Dispatched via gate_invoke (catalog mode long-tail). Prefer direct tools when listed.",
  };
}
