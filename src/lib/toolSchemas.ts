/**
 * Shared Zod input schemas for Gate tools.
 * Used by MCP registration (main.ts) and gate_invoke (invoke.ts) for parity.
 */

import { z } from "zod";

export const optimizeImageSchema = z.object({
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
});

export const compressFileSchema = z.object({
  filePath: z
    .string()
    .describe("Absolute or relative path to the code file"),
  depth: z
    .enum(["signature", "summary", "structure", "full"])
    .optional()
    .default("signature")
    .describe(
      "signature (AST, default), structure (YAML/MD keys), summary (code only), full (raw)"
    ),
  projectRoot: z
    .string()
    .optional()
    .describe(
      "Optional project root (narrows GATE_PROJECT_ROOT; cannot widen). Use for multi-repo workspaces."
    ),
});

export const graphQuerySchema = z.object({
  query: z
    .string()
    .describe("Symbol name, file name, or search term to query"),
  projectRoot: z
    .string()
    .optional()
    .describe("Project root directory (defaults to cwd)"),
  queryType: z
    .enum([
      "depends_on",
      "dependents",
      "file_symbols",
      "search",
      "stats",
      "symbol_map",
      "export_html",
      "graphify_hubs",
      "graphify_search",
      "graphify_map",
    ])
    .optional()
    .default("search")
    .describe(
      "Symbol: search | depends_on | dependents | file_symbols | stats | symbol_map | export_html. " +
        "Graphify map (nested graphify-out/): graphify_hubs | graphify_search | graphify_map. " +
        "search auto-fallback to graphify when 0 symbol hits."
    ),
  rebuild: z
    .boolean()
    .optional()
    .default(false)
    .describe("Force rebuild the graph (invalidates cache)"),
  tokenBudget: z
    .number()
    .optional()
    .describe("Token budget for queryType=symbol_map (default 1200)"),
});

export const memorySchema = z.object({
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
});

export const dedupContextSchema = z.object({
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
  projectRoot: z
    .string()
    .optional()
    .describe(
      "Optional project root (narrows GATE_PROJECT_ROOT). Use the same value as gate_compress_file."
    ),
});

export const cleanResponseSchema = z.object({
  data: z.string().describe("Raw JSON string to compress"),
  format: z
    .enum(["toon", "compact", "whitelist"])
    .optional()
    .default("toon")
    .describe(
      "Compression format: 'toon' (tabular, default), 'compact' (minified), 'whitelist' (field filter)"
    ),
  whitelist: z
    .array(z.string())
    .optional()
    .describe("Fields to keep (whitelist mode only)"),
  maxArrayItems: z
    .number()
    .optional()
    .default(50)
    .describe("Max array items before truncation (default 50)"),
});

export const proxyToolsSchema = z.object({
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
});

export const proxyCallSchema = z.object({
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
  // Positive only — timeoutMs:0 previously disabled hang protection via invoke.
  timeoutMs: z
    .number()
    .positive()
    .optional()
    .describe(
      "Per-call timeout in ms (must be > 0). Defaults to 30000 or GATE_PROXY_TIMEOUT_MS."
    ),
});

export const validateCompressionSchema = z.object({
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
});

export const gateInitSchema = z.object({
  projectRoot: z
    .string()
    .optional()
    .describe("Project root (defaults to cwd / GATE_PROJECT_ROOT)"),
});

export const sessionStatsSchema = z.object({
  projectRoot: z
    .string()
    .optional()
    .describe(
      "Optional project root for persistent cache totals (same as gate_compress_file)."
    ),
});

export const helpSchema = z.object({
  tool: z
    .string()
    .optional()
    .describe("Tool name to get docs for, or omit for directory"),
});

export const invokeSchema = z.object({
  tool: z
    .string()
    .describe("Gate tool name, e.g. gate_memory or gate_clean_response"),
  args: z
    .record(z.unknown())
    .optional()
    .describe("Arguments object for the target tool"),
});

/** Per-tool schemas keyed by GateToolName (for gate_invoke). */
export const TOOL_ARG_SCHEMAS = {
  gate_optimize_image: optimizeImageSchema,
  gate_compress_file: compressFileSchema,
  gate_graph_query: graphQuerySchema,
  gate_memory: memorySchema,
  gate_dedup_context: dedupContextSchema,
  gate_clean_response: cleanResponseSchema,
  gate_proxy_tools: proxyToolsSchema,
  gate_proxy_call: proxyCallSchema,
  gate_validate_compression: validateCompressionSchema,
  gate_init: gateInitSchema,
  gate_session_stats: sessionStatsSchema,
  gate_help: helpSchema,
} as const;
