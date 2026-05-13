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

// ─── Server initialization ─────────────────────────────────────────────────

const server = new McpServer({
  name: "gate",
  version: "0.2.0-alpha",
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
    description: "Cross-session key-value persistence to .gate-mcp/memory.json. Use gate_help for full docs.",
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

// ─── Tool 7: gate_help ──────────────────────────────────────────────────────

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

// ─── Start server ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info("Starting Gate-MCP server v0.2.0-alpha...");

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info("Gate-MCP server connected via stdio transport");
}

main().catch((err) => {
  logger.error(`Fatal error starting Gate-MCP: ${err}`);
  process.exit(1);
});
