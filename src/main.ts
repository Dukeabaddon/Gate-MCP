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
import { z } from "zod";
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
import { terminateOcr } from "./lib/imageProcessor.js";
import { closeCacheDb } from "./lib/cacheDb.js";
import { closeAllProxies } from "./lib/proxyClient.js";

// ─── Server initialization ─────────────────────────────────────────────────

const server = new McpServer({
  name: "gatemcp",
  version: "0.5.2",
});

// ─── Tool 1: gate_optimize_image ────────────────────────────────────────────

server.registerTool(
  "gate_optimize_image",
  {
    title: "Gate Optimize Image",
    description: "Compress images via OCR text extraction or downscaling. 76-97% savings. Use gate_help for full docs.",
    inputSchema: z.object({
      imagePath: z
        .string()
        .describe("Absolute or relative path to the image file"),
      intent: z
        .enum(["text", "visual", "auto"])
        .optional()
        .default("auto")
        .describe(
          "Processing intent: 'text' extracts OCR text, 'visual' downscales, 'auto' decides based on OCR confidence"
        ),
    }),
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

server.registerTool(
  "gate_compress_file",
  {
    title: "Gate Compress File",
    description: "AST code compression via tree-sitter. Extract signatures, discard implementation. 46-94% savings. Use gate_help for full docs.",
    inputSchema: z.object({
      filePath: z
        .string()
        .describe("Absolute or relative path to the code file"),
      depth: z
        .enum(["signature", "summary", "full"])
        .optional()
        .default("signature")
        .describe(
          "Compression depth: 'signature' (most compressed), 'summary' (moderate), 'full' (no compression)"
        ),
    }),
  },
  async (args) => {
    try {
      const result = await handleCompressFile({
        filePath: args.filePath,
        depth: args.depth,
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

server.registerTool(
  "gate_graph_query",
  {
    title: "Gate Graph Query",
    description: "Symbol dependency graph with BFS traversal. Find, trace, navigate code without reading files. 93-99% savings. Use gate_help for full docs.",
    inputSchema: z.object({
      query: z
        .string()
        .describe("Symbol name, file name, or search term to query"),
      projectRoot: z
        .string()
        .optional()
        .describe("Project root directory (defaults to cwd)"),
      queryType: z
        .enum(["depends_on", "dependents", "file_symbols", "search", "stats"])
        .optional()
        .default("search")
        .describe(
          "'search' = find symbols by name, 'depends_on' = what does X import/use, " +
          "'dependents' = what uses X, 'file_symbols' = list symbols in a file, " +
          "'stats' = graph overview"
        ),
      rebuild: z
        .boolean()
        .optional()
        .default(false)
        .describe("Force rebuild the graph (invalidates cache)"),
    }),
  },
  async (args) => {
    try {
      const result = await handleGraphQuery({
        query: args.query,
        projectRoot: args.projectRoot,
        queryType: args.queryType,
        rebuild: args.rebuild,
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

server.registerTool(
  "gate_memory",
  {
    title: "Gate Memory",
    description:
      "Cross-session KV persistence in SQLite (.gate-mcp/cache.db) or memory.json fallback. Use gate_help for full docs.",
    inputSchema: z.object({
      action: z
        .enum(["read", "write", "delete", "list", "clear"])
        .describe("Memory operation: read/write/delete a key, list all keys, or clear all"),
      key: z.string().describe("Memory key identifier (use '*' for list/clear)"),
      value: z
        .string()
        .optional()
        .describe("Value to store (required for 'write' action)"),
      projectRoot: z
        .string()
        .optional()
        .describe("Project root directory (defaults to cwd)"),
    }),
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

server.registerTool(
  "gate_dedup_context",
  {
    title: "Gate Dedup Context",
    description: "Session dedup cache. Auto-integrated into gate_compress_file. Use 'stats'/'clear' to manage. Use gate_help for full docs.",
    inputSchema: z.object({
      action: z
        .enum(["check", "store", "stats", "clear"])
        .describe(
          "'check' = look up file in cache, 'store' = cache compressed content, " +
          "'stats' = view cache analytics, 'clear' = reset cache"
        ),
      filePath: z
        .string()
        .optional()
        .describe("File path (required for check/store)"),
      content: z
        .string()
        .optional()
        .describe("Compressed content to cache (required for store)"),
      originalTokens: z
        .number()
        .optional()
        .describe("Original token count before compression (for store)"),
    }),
  },
  async (args) => {
    try {
      const result = await handleDedupContext({
        action: args.action,
        filePath: args.filePath,
        content: args.content,
        originalTokens: args.originalTokens,
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

server.registerTool(
  "gate_clean_response",
  {
    title: "Gate Clean Response",
    description: "TOON JSON compressor. Arrays→pipe tables, 37-81% savings. Modes: toon/compact/whitelist. Use gate_help for full docs.",
    inputSchema: z.object({
      data: z.string().describe("Raw JSON string to compress"),
      format: z
        .enum(["toon", "compact", "whitelist"])
        .optional()
        .default("toon")
        .describe("Compression format: 'toon' (tabular, default), 'compact' (minified), 'whitelist' (field filter)"),
      whitelist: z
        .array(z.string())
        .optional()
        .describe("Fields to keep (whitelist mode only)"),
      maxArrayItems: z
        .number()
        .optional()
        .default(50)
        .describe("Max array items before truncation (default 50)"),
    }),
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

server.registerTool(
  "gate_proxy_tools",
  {
    title: "Gate Proxy Tools",
    description:
      "Compressed catalog of every tool from your downstream MCP servers " +
      "(GitHub, Postgres, etc.) configured in .gate-mcp/proxy-servers.json. " +
      "Modes: list (default), describe (full schema for one tool), status, refresh. " +
      "Cuts the per-turn MCP schema overhead by 70-90%. Use gate_help for full docs.",
    inputSchema: z.object({
      action: z
        .enum(["list", "describe", "status", "refresh"])
        .optional()
        .default("list")
        .describe(
          "'list' = compressed catalog (default), 'describe' = full schema for one tool, " +
            "'status' = currently open downstream connections, 'refresh' = drop cache + re-list"
        ),
      server: z
        .string()
        .optional()
        .describe(
          "Server name from proxy-servers.json. Required for describe; filters list."
        ),
      tool: z
        .string()
        .optional()
        .describe("Tool name on the chosen server. Required for describe."),
      maxPerServer: z
        .number()
        .optional()
        .default(999)
        .describe("Cap tools listed per server (debug aid)."),
      projectRoot: z
        .string()
        .optional()
        .describe("Project root (defaults to cwd / GATE_PROJECT_ROOT)."),
    }),
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

server.registerTool(
  "gate_proxy_call",
  {
    title: "Gate Proxy Call",
    description:
      "Invoke a tool on a downstream MCP server through gatemcp's compressor. " +
      "Response is auto-compressed via TOON unless format='raw'. " +
      "Use gate_proxy_tools first to discover servers/tools. Use gate_help for full docs.",
    inputSchema: z.object({
      server: z
        .string()
        .describe("Downstream server name (must exist in proxy-servers.json)."),
      tool: z.string().describe("Tool name on the downstream server."),
      args: z
        .record(z.unknown())
        .optional()
        .describe("Arguments forwarded verbatim to the downstream tool."),
      format: z
        .enum(["toon", "compact", "whitelist", "raw"])
        .optional()
        .default("toon")
        .describe(
          "Response compression: 'toon' (tabular, default), 'compact' (minified JSON), " +
            "'whitelist' (keep only listed fields), 'raw' (no compression)."
        ),
      whitelist: z
        .array(z.string())
        .optional()
        .describe("Fields to keep (whitelist mode only)."),
      maxArrayItems: z
        .number()
        .optional()
        .default(50)
        .describe("Max array items before truncation."),
      projectRoot: z
        .string()
        .optional()
        .describe("Project root (defaults to cwd / GATE_PROJECT_ROOT)."),
      timeoutMs: z
        .number()
        .optional()
        .describe(
          "Per-call timeout in ms. 0 disables. Defaults to 30000 or GATE_PROXY_TIMEOUT_MS env var."
        ),
    }),
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

server.registerTool(
  "gate_validate_compression",
  {
    title: "Gate Validate Compression",
    description:
      "LLM-in-the-loop validator: prove the compressed view of a file preserves enough signal " +
      "for real LLM work. Returns 0-100 quality score across symbol recall, usage-code, and " +
      "specificity. Default provider 'mock' runs without API keys. Use gate_help for full docs.",
    inputSchema: z.object({
      filePath: z.string().describe("Path to the source file to validate."),
      mode: z
        .enum(["prompts", "score", "run"])
        .optional()
        .default("run")
        .describe(
          "'prompts' = generate test prompts only, 'score' = score caller-supplied responses, " +
            "'run' = call the configured provider end-to-end"
        ),
      responses: z
        .record(z.string())
        .optional()
        .describe(
          "When mode='score', a dict mapping prompt id to the LLM's text response."
        ),
      provider: z
        .enum(["mock", "ollama", "openai"])
        .optional()
        .default("mock")
        .describe(
          "'mock' (default, no API key), 'ollama' (local http://localhost:11434), 'openai' (needs OPENAI_API_KEY)"
        ),
      providerOpts: z
        .record(z.unknown())
        .optional()
        .describe("Provider-specific options (model, baseUrl, apiKey)."),
      projectRoot: z
        .string()
        .optional()
        .describe("Project root (defaults to cwd / GATE_PROJECT_ROOT)."),
    }),
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

// ─── Tool 10: gate_help ─────────────────────────────────────────────────────

server.registerTool(
  "gate_help",
  {
    title: "Gate Help",
    description: "Full docs for any Gate-MCP tool. Call with tool='<name>' or omit for directory.",
    inputSchema: z.object({
      tool: z
        .string()
        .optional()
        .describe("Tool name to get docs for, or omit for directory"),
    }),
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
    await closeAllProxies();
  } catch (err) {
    logger.warn(`Proxy connection cleanup failed during shutdown: ${err}`);
  }
  process.exit(0);
}

process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("beforeExit", () => void gracefulShutdown("beforeExit"));

// ─── Start server ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info("Starting gatemcp server v0.5.2...");

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info("gatemcp server connected via stdio transport");
}

main().catch((err) => {
  logger.error(`Fatal error starting gatemcp: ${err}`);
  process.exit(1);
});
