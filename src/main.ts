#!/usr/bin/env node
/**
 * Gate-MCP Server — Context Compression Gateway
 *
 * An MCP server that compresses AI context to save input tokens.
 * Supports image optimization (OCR + downscale) and code file compression (AST signatures).
 *
 * CRITICAL: All logging via console.error. stdout is reserved for JSON-RPC.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import logger from "./lib/logger.js";
import { handleOptimizeImage } from "./tools/optimizeImage.js";
import { handleCompressFile } from "./tools/compressFile.js";
import { handleGraphQuery } from "./tools/graphQuery.js";
import { handleMemory } from "./tools/memory.js";
import { handleDedupContext } from "./tools/dedupContext.js";
import { handleCleanResponse } from "./tools/cleanResponse.js";
import { handleHelp } from "./tools/help.js";
import { handleProxyTools, handleProxyCall } from "./tools/proxyTools.js";
import { handleValidateCompression } from "./tools/validateCompression.js";
import { handleSessionStats } from "./tools/sessionStats.js";
import { handleGateInit } from "./tools/gateInit.js";
import { handleInvoke } from "./tools/invoke.js";
import { GATEMCP_VERSION } from "./version.js";
import { terminateOcr } from "./lib/imageProcessor.js";
import { closeCacheDb } from "./lib/cacheDb.js";
import { closeAllMemoryDbs } from "./lib/memoryDb.js";
import { closeAllProxies } from "./lib/proxyClient.js";
import { resolveToolMode, shouldRegisterTool } from "./lib/toolMode.js";
import { assertSqliteModuleOrExit } from "./lib/sqliteRequired.js";
import {
  cleanResponseSchema,
  compressFileSchema,
  dedupContextSchema,
  gateInitSchema,
  graphQuerySchema,
  helpSchema,
  invokeSchema,
  memorySchema,
  optimizeImageSchema,
  proxyCallSchema,
  proxyToolsSchema,
  sessionStatsSchema,
  validateCompressionSchema,
} from "./lib/toolSchemas.js";
import { buildGraph, invalidateGraph } from "./lib/symbolGraph.js";
import { writeSymbolGraphHtml } from "./lib/symbolGraphViz.js";
import { resolveCodeRoot } from "./lib/projectRoot.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { formatDoctorReport, runDoctor } from "./doctor.js";

// ─── Server initialization ─────────────────────────────────────────────────

const toolMode = resolveToolMode();

const server = new McpServer({
  name: "gatemcp",
  version: GATEMCP_VERSION,
});

type AnyToolConfig = {
  title?: string;
  description?: string;
  inputSchema?: unknown;
  [key: string]: unknown;
};

function registerGateTool(
  name: string,
  config: AnyToolConfig,
  handler: (...args: any[]) => any
): void {
  if (!shouldRegisterTool(name, toolMode)) {
    logger.info(`toolMode=${toolMode}: not listing ${name}`);
    return;
  }
  // SDK overloads make Parameters<> resolve to never — cast at the boundary.
  (server.registerTool as (n: string, c: unknown, h: unknown) => void)(
    name,
    config,
    handler
  );
}

// ─── Tool 1: gate_optimize_image ────────────────────────────────────────────

registerGateTool(
  "gate_optimize_image",
  {
    title: "Gate Optimize Image",
    description:
      "Compress images via OCR text extraction or downscaling with measured results. See gate_help (recommended_stack).",
    inputSchema: optimizeImageSchema,
  },
  async (args) => {
    try {
      const result = await handleOptimizeImage({
        imagePath: args.imagePath,
        intent: args.intent,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`gate_optimize_image failed: ${message}`);
      return {
        content: [{ type: "text", text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  }
);

// ─── Tool 2: gate_compress_file ─────────────────────────────────────────────

registerGateTool(
  "gate_compress_file",
  {
    title: "Gate Compress File",
    description:
      "AST/structure file compression. Code: signature. YAML/MD: auto structure. See gate_help recommended_stack.",
    inputSchema: compressFileSchema,
  },
  async (args) => {
    try {
      const result = await handleCompressFile({
        filePath: args.filePath,
        depth: args.depth,
        projectRoot: args.projectRoot,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`gate_compress_file failed: ${message}`);
      return {
        content: [{ type: "text", text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  }
);

// ─── Tool 3: gate_graph_query ───────────────────────────────────────────────

registerGateTool(
  "gate_graph_query",
  {
    title: "Gate Graph Query",
    description:
      "Symbol graph + graphify map. graphify_map/search/hubs for communities. search auto-fallback. See gate_help recommended_stack.",
    inputSchema: graphQuerySchema,
  },
  async (args) => {
    try {
      const result = await handleGraphQuery({
        query: args.query,
        projectRoot: args.projectRoot,
        queryType: args.queryType,
        rebuild: args.rebuild,
        tokenBudget: args.tokenBudget,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`gate_graph_query failed: ${message}`);
      return {
        content: [{ type: "text", text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  }
);

// ─── Tool 4: gate_memory ─────────────────────────────────────────────────────

registerGateTool(
  "gate_memory",
  {
    title: "Gate Memory",
    description:
      "Cross-session KV persistence in SQLite (.gate-mcp/cache.db) or memory.json fallback. Use gate_help for full docs.",
    inputSchema: memorySchema,
  },
  async (args) => {
    try {
      const result = await handleMemory({
        action: args.action,
        key: args.key,
        value: args.value,
        projectRoot: args.projectRoot,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`gate_memory failed: ${message}`);
      return {
        content: [{ type: "text", text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  }
);

// ─── Tool 5: gate_dedup_context ─────────────────────────────────────────────

registerGateTool(
  "gate_dedup_context",
  {
    title: "Gate Dedup Context",
    description: "Session dedup cache. Auto-integrated into gate_compress_file. Use 'stats'/'clear' to manage. Use gate_help for full docs.",
    inputSchema: dedupContextSchema,
  },
  async (args) => {
    try {
      const result = await handleDedupContext({
        action: args.action,
        filePath: args.filePath,
        content: args.content,
        originalTokens: args.originalTokens,
        projectRoot: args.projectRoot,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`gate_dedup_context failed: ${message}`);
      return {
        content: [{ type: "text", text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  }
);

// ─── Tool 6: gate_clean_response ────────────────────────────────────────────

registerGateTool(
  "gate_clean_response",
  {
    title: "Gate Clean Response",
    description: "TOON JSON compressor with measured per-result savings. Modes: toon/compact/whitelist. Use gate_help for full docs.",
    inputSchema: cleanResponseSchema,
  },
  async (args) => {
    try {
      const result = await handleCleanResponse({
        data: args.data,
        format: args.format,
        whitelist: args.whitelist,
        maxArrayItems: args.maxArrayItems,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`gate_clean_response failed: ${message}`);
      return {
        content: [{ type: "text", text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  }
);

// ─── Tool 7: gate_proxy_tools ───────────────────────────────────────────────

registerGateTool(
  "gate_proxy_tools",
  {
    title: "Gate Proxy Tools",
    description:
      "Compressed catalog of every tool from your downstream MCP servers " +
      "(GitHub, Postgres, etc.) configured in .gate-mcp/proxy-servers.json. " +
      "Modes: list (default), describe (full schema for one tool), status, refresh. " +
      "Disabled until GATE_ENABLE_PROXY=1. Reports measured catalog savings. Use gate_help for full docs.",
    inputSchema: proxyToolsSchema,
  },
  async (args) => {
    try {
      const result = await handleProxyTools({
        action: args.action,
        server: args.server,
        tool: args.tool,
        maxPerServer: args.maxPerServer,
        projectRoot: args.projectRoot,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`gate_proxy_tools failed: ${message}`);
      return {
        content: [{ type: "text", text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  }
);

// ─── Tool 8: gate_proxy_call ────────────────────────────────────────────────

registerGateTool(
  "gate_proxy_call",
  {
    title: "Gate Proxy Call",
    description:
      "Invoke a tool on a downstream MCP server through gatemcp's compressor. " +
      "Response is auto-compressed via TOON unless format='raw'. " +
      "Use gate_proxy_tools first to discover servers/tools. Use gate_help for full docs.",
    inputSchema: proxyCallSchema,
  },
  async (args) => {
    try {
      const result = await handleProxyCall({
        server: args.server,
        tool: args.tool,
        args: args.args as Record<string, unknown> | undefined,
        format: args.format,
        whitelist: args.whitelist,
        maxArrayItems: args.maxArrayItems,
        projectRoot: args.projectRoot,
        timeoutMs: args.timeoutMs,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: result.isError,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`gate_proxy_call failed: ${message}`);
      return {
        content: [{ type: "text", text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  }
);

// ─── Tool 9: gate_validate_compression ──────────────────────────────────────

registerGateTool(
  "gate_validate_compression",
  {
    title: "Gate Validate Compression",
    description:
      "LLM-in-the-loop validator: prove the compressed view of a file preserves enough signal " +
      "for real LLM work. Returns 0-100 quality score across symbol recall, usage-code, and " +
      "specificity. Default provider 'mock' runs without API keys. Use gate_help for full docs.",
    inputSchema: validateCompressionSchema,
  },
  async (args) => {
    try {
      const result = await handleValidateCompression({
        filePath: args.filePath,
        mode: args.mode,
        responses: args.responses,
        provider: args.provider,
        providerOpts: args.providerOpts as Record<string, unknown> | undefined,
        projectRoot: args.projectRoot,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`gate_validate_compression failed: ${message}`);
      return {
        content: [{ type: "text", text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  }
);

// ─── Tool 10: gate_init ─────────────────────────────────────────────────────

registerGateTool(
  "gate_init",
  {
    title: "Gate Init",
    description:
      "Project health: graphify map, dedup cache path, MCP slug hint. Run once per repo. See gate_help.",
    inputSchema: gateInitSchema,
  },
  async (args) => {
    try {
      const result = await handleGateInit({ projectRoot: args.projectRoot });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`gate_init failed: ${message}`);
      return {
        content: [{ type: "text", text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  }
);

// ─── Tool 11: gate_session_stats ────────────────────────────────────────────

registerGateTool(
  "gate_session_stats",
  {
    title: "Gate Session Stats",
    description:
      "Measured file/byte/token work plus dedup cache activity. See gate_help gate_session_stats.",
    inputSchema: sessionStatsSchema,
  },
  async (args) => {
    try {
      const result = await handleSessionStats({
        projectRoot: args.projectRoot,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`gate_session_stats failed: ${message}`);
      return {
        content: [{ type: "text", text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  }
);

// ─── Tool: gate_invoke (catalog mode long-tail) ─────────────────────────────

registerGateTool(
  "gate_invoke",
  {
    title: "Gate Invoke",
    description:
      "Catalog mode: call any Gate tool by name with args. Use for tools not in tools/list. See gate_help.",
    inputSchema: invokeSchema,
  },
  async (args) => {
    try {
      const result = await handleInvoke({
        tool: args.tool,
        args: args.args as Record<string, unknown> | undefined,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`gate_invoke failed: ${message}`);
      return {
        content: [{ type: "text", text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  }
);

// ─── Tool: gate_help ────────────────────────────────────────────────────────

registerGateTool(
  "gate_help",
  {
    title: "Gate Help",
    description:
      "Full docs for any Gate-MCP tool. tool='recommended_stack' for navigation playbook; omit for directory.",
    inputSchema: helpSchema,
  },
  async (args) => {
    try {
      const result = await handleHelp({ tool: args.tool });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`gate_help failed: ${message}`);
      return {
        content: [{ type: "text", text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  }
);

// ─── Graceful shutdown ──────────────────────────────────────────────────────

let shuttingDown = false;
async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal} — running graceful shutdown...`);
  try {
    await terminateOcr();
  } catch (err) {
    logger.warn(`OCR cleanup failed during shutdown: ${err}`);
  }
  try {
    closeCacheDb();
  } catch (err) {
    logger.warn(`Cache DB cleanup failed during shutdown: ${err}`);
  }
  try {
    closeAllMemoryDbs();
  } catch (err) {
    logger.warn(`Memory DB cleanup failed during shutdown: ${err}`);
  }
  try {
    await closeAllProxies();
  } catch (err) {
    logger.warn(`Proxy connection cleanup failed during shutdown: ${err}`);
  }
  process.exit(0);
}

// ─── Start server ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (process.argv[2] === "doctor") {
    const doctorArgs = process.argv.slice(3);
    const json = doctorArgs.includes("--json");
    const strict = doctorArgs.includes("--strict");
    const projectRoot = doctorArgs.find((arg) => !arg.startsWith("--"));
    const report = await runDoctor({
      projectRoot,
      serverEntrypoint: fileURLToPath(import.meta.url),
      strict,
    });
    if (json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stderr.write(`${formatDoctorReport(report)}\n`);
    }
    closeCacheDb();
    closeAllMemoryDbs();
    process.exitCode = report.ok ? 0 : 1;
    return;
  }

  if (process.argv[2] === "graph-html") {
    const rootArg = process.argv.slice(3).find((arg) => !arg.startsWith("--"));
    const resolvedRoot = resolveCodeRoot(rootArg);
    invalidateGraph();
    const graph = buildGraph(resolvedRoot);
    const outPath = path.join(resolvedRoot, ".gate-mcp", "symbol-graph.html");
    const written = writeSymbolGraphHtml(graph, outPath, {
      title: `Gate symbol graph — ${path.basename(resolvedRoot)}`,
      projectRoot: resolvedRoot,
    });
    process.stdout.write(
      `${JSON.stringify({ ok: true, ...written, indexedRoot: resolvedRoot }, null, 2)}\n`
    );
    return;
  }

  process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
  process.on("beforeExit", () => void gracefulShutdown("beforeExit"));

  assertSqliteModuleOrExit();
  logger.info(
    `Starting gatemcp server v${GATEMCP_VERSION} (toolMode=${toolMode})...`
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info("gatemcp server connected via stdio transport");
}

main().catch((err) => {
  logger.error(`Fatal error starting gatemcp: ${err}`);
  process.exit(1);
});
