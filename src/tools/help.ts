/**
 * gate_help — Tool documentation registry.
 *
 * Enables terse tool descriptions in ListTools (saving ~90% schema tokens)
 * while providing full documentation on demand via this meta-tool.
 *
 * Inspired by Atlassian's mcp-compressor lazy-loading pattern.
 */

import { countTextTokens } from "../lib/tokenCounter.js";
import logger from "../lib/logger.js";

export interface HelpInput {
  tool?: string; // specific tool name, or omit for directory
}

export interface HelpResult {
  tool: string;
  documentation: string;
  tokens: number;
  note: string;
}

/**
 * Full documentation for every Gate-MCP tool.
 */
const TOOL_DOCS: Record<string, string> = {
  gate_optimize_image: `# gate_optimize_image
Compress image inputs by extracting text (OCR) or downscaling.
Returns token savings metrics.

## Parameters
- imagePath (required): Absolute or relative path to the image file
- intent (optional): 'text' | 'visual' | 'auto' (default: 'auto')
  - 'text': Extracts OCR text from screenshots/docs (returns text, not image)
  - 'visual': Downscales to 512px max width with 80% JPEG quality
  - 'auto': Checks OCR confidence. High confidence → text mode, else visual mode

## When to use
- Before including images in context
- For screenshots: use intent='text' to extract content as text
- For diagrams/photos: use intent='visual' to reduce resolution
- Typical savings: 76-97%`,

  gate_compress_file: `# gate_compress_file
AST-based code compression via tree-sitter. Extracts function signatures,
class definitions, imports, and type declarations — discarding implementation.

## Parameters
- filePath (required): Path to the source file
- depth (optional): 'signature' | 'summary' | 'full' (default: 'signature')
  - 'signature': Function names, params, return types, imports only
  - 'summary': One-line per function with brief description
  - 'full': Returns raw file content (baseline comparison)

## When to use
- When you need to understand a file's API without reading implementation
- Before adding files to context window
- Supports: TypeScript, JavaScript, Python, and plain text
- Typical savings: 46-94%
- Auto-caches results (repeated reads are nearly free via gate_dedup_context)`,

  gate_graph_query: `# gate_graph_query
In-memory symbol dependency graph built from tree-sitter ASTs.
BFS traversal for dependency discovery without reading files.

## Parameters
- query (required): Search term, filename, or symbol name
- queryType (optional): 'search' | 'depends_on' | 'dependents' | 'file_symbols' | 'stats'
  - 'search': Find symbols matching a string (fuzzy)
  - 'depends_on': BFS traverse what a file/symbol depends on
  - 'dependents': BFS traverse what depends on a file/symbol
  - 'file_symbols': List all symbols in a specific file
  - 'stats': Graph statistics (node count, edge count, build time)
- projectRoot (optional): Project root directory
- rebuild (optional): Force graph rebuild (default: uses cache)

## When to use
- BEFORE reading files — find what you need first
- Understanding dependency chains without opening files
- Typical savings: 93-99% vs reading all files
- Scales to 6,000+ files (tested on VSCode repo)`,

  gate_memory: `# gate_memory
Cross-session key-value persistence (v0.5.2).

## Storage
- Primary: SQLite table \`memory_entries\` in \`.gate-mcp/cache.db\` (same file as dedup cache, WAL-safe for concurrent IDEs).
- Fallback: \`.gate-mcp/memory.json\` when better-sqlite3 is unavailable.
- One-time migration: existing memory.json → SQLite, then renamed to memory.json.migrated.

## Parameters
- action (required): 'read' | 'write' | 'delete' | 'list' | 'clear'
- key (required): Memory key identifier (use '*' for list/clear)
- value (optional): Value to store (required for 'write')
- projectRoot (optional): Project root (default: cwd)

## When to use
- Persist decisions or findings across sessions
- Store user preferences or project conventions
- LRU caps: 2,000 keys / ~10 MB total value size`,

  gate_dedup_context: `# gate_dedup_context
Session-level SHA-256 content deduplication cache.
Automatically integrated into gate_compress_file.

## Parameters
- action (required): 'check' | 'store' | 'stats' | 'clear'
- filePath (optional): File path for check/store
- content (optional): Content to cache for store

## When to use
- Automatically used by gate_compress_file (no manual calls needed)
- Use 'stats' to see cache analytics (hits, tokens saved)
- Use 'clear' to reset cache
- Repeated file reads cost ~15 tokens instead of 150+`,

  gate_clean_response: `# gate_clean_response
TOON (Token-Optimized Object Notation) JSON compressor.
Arrays of objects → pipe-delimited tables.

## Parameters
- data (required): Raw JSON string to compress
- format (optional): 'toon' | 'compact' | 'whitelist' (default: 'toon')
  - 'toon': Headers once, data as pipe-delimited rows (best for arrays)
  - 'compact': Minified JSON (removes whitespace)
  - 'whitelist': Keep only specified fields, then apply TOON
- whitelist (optional): Array of field names to keep (whitelist mode only)
- maxArrayItems (optional): Max items before truncation (default: 50)

## When to use
- Compress verbose JSON API responses before including in context
- Use 'whitelist' to drop unneeded fields (e.g., keep only id, name, status)
- Typical savings: 37% (arrays), 81% (whitelist)`,

  gate_proxy_tools: `# gate_proxy_tools
Compressed catalog of every tool from your downstream MCP servers
(GitHub, Postgres, Filesystem, etc.). Treats gatemcp as a single
MCP endpoint that fronts your whole MCP server roster.

## Parameters
- action (required): 'list' | 'describe' | 'status' | 'refresh' (default: 'list')
  - 'list': Compressed catalog of all downstream tools (default)
  - 'describe': Full JSON Schema for one specific tool (call this just before invoking)
  - 'status': Currently open downstream connections
  - 'refresh': Drop cached connections + re-list (use after restarting a server)
- server (optional): Filters list to one server; required for describe
- tool (optional): Tool name on the chosen server; required for describe
- maxPerServer (optional): Cap tools listed per server (debug aid, default 999)
- projectRoot (optional): Project root for config lookup

## Configuration
Create .gate-mcp/proxy-servers.json in your project root:
\`\`\`json
{
  "servers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "..." }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/project"]
    }
  }
}
\`\`\`
Override the config path with GATE_PROXY_CONFIG env var.

## When to use
- When you have 5+ MCP servers configured and per-turn schema overhead is hurting context budget
- Use 'list' once per session to discover; the LLM should call 'describe' only before invoking a specific tool
- Typical savings on a 10-server roster: 70-90% of MCP schema overhead`,

  gate_proxy_call: `# gate_proxy_call
Forward a tool invocation to a downstream MCP server through gatemcp's
compressor. Response is auto-compressed via TOON (or pass format='raw' to bypass).

## Parameters
- server (required): Downstream server name (must exist in proxy-servers.json)
- tool (required): Tool name on the downstream server
- args (optional): Object of arguments forwarded verbatim to the downstream tool
- format (optional): 'toon' | 'compact' | 'whitelist' | 'raw' (default: 'toon')
- whitelist (optional): Fields to keep when format='whitelist'
- maxArrayItems (optional): Truncate large arrays in the response (default 50)
- projectRoot (optional): Project root for config lookup
- timeoutMs (optional): Per-call timeout in ms. 0 disables. Defaults to 30000 or GATE_PROXY_TIMEOUT_MS env var.

## When to use
- After gate_proxy_tools list/describe has shown you which downstream tool to call
- The compressed response is what the LLM sees — raw response stays on gatemcp
- Connections are kept warm across calls (one spawn per server per session)
- Wedged downstream servers are auto-dropped on timeout`,

  gate_validate_compression: `# gate_validate_compression
LLM-in-the-loop validator for the compression pipeline. Asks the question:
"If an LLM only sees the compressed view of this file, can it still do real work?"
Returns a 0-100 score across three dimensions:
  - Symbol recall (40%): does the LLM still know every exported symbol?
  - Usage code (35%): can it write a fresh file that imports + uses 3+ exports?
  - Specificity (25%): are audit/test answers grounded in real symbols, not generic?

## Parameters
- filePath (required): Source file to validate (any supported language)
- mode (optional): 'prompts' | 'score' | 'run' (default: 'run')
  - 'prompts': Generate the 4 validation prompts only (no LLM call). For tooling
    that wants to drive its own LLM and submit responses back.
  - 'score': Accept caller-supplied LLM responses and score them. Use when your
    IDE's own LLM is the judge — pass responses keyed by prompt id.
  - 'run': Call the configured provider end-to-end, then score.
- responses (optional): When mode='score', dict of {promptId: responseText}
- provider (optional): 'mock' (default, no API key) | 'ollama' | 'openai'
  - 'mock': Deterministic baseline used by CI tests — produces a perfect or
    half-faulty response so the scoring code path is exercised
  - 'ollama': Local Ollama HTTP server (default http://localhost:11434).
    Env: OLLAMA_BASE_URL, OLLAMA_MODEL (default qwen2.5-coder:7b)
  - 'openai': OpenAI / OpenAI-compatible endpoint.
    Env: OPENAI_API_KEY (required), OPENAI_BASE_URL, OPENAI_MODEL (default gpt-4o-mini)
- providerOpts (optional): Override provider config inline ({model, baseUrl, apiKey})

## When to use
- After changing the AST extractor — guard against silent fidelity regressions
- Before promoting a new language to "supported" tier — confirm the LLM
  experience is acceptable, not just that the parser doesn't crash
- In CI with provider='mock' for cheap regression coverage
- As a manual experiment with provider='ollama' for free real-LLM signal`,

  gate_help: `# gate_help
This tool. Returns full documentation for any Gate-MCP tool.

## Parameters
- tool (optional): Tool name to get docs for. Omit for directory of all tools.

## When to use
- When you need detailed parameter docs for a specific tool
- When tool descriptions seem terse — this is the full reference`,
};

/**
 * Handle a help request.
 */
export async function handleHelp(args: HelpInput): Promise<HelpResult> {
  const { tool } = args;

  // Directory mode — list all tools with one-line descriptions
  if (!tool || tool === "all" || tool === "directory") {
    const directory = [
      "# gatemcp Tool Directory (v0.5.2)",
      "",
      "| Tool | Purpose |",
      "|---|---|",
      "| gate_optimize_image | Compress images via OCR/downscale (76-97% savings) |",
      "| gate_compress_file | AST code compression via tree-sitter (46-94% savings) |",
      "| gate_graph_query | Symbol dependency graph with BFS (93-99% savings) |",
      "| gate_memory | Cross-session key-value persistence |",
      "| gate_dedup_context | SHA-256 session dedup cache (auto-integrated, SQLite-backed) |",
      "| gate_clean_response | TOON JSON compressor (37-81% savings) |",
      "| gate_proxy_tools | Compressed catalog of downstream MCP servers (70-90% schema savings) |",
      "| gate_proxy_call | Forward a downstream MCP tool call through gatemcp's compressor |",
      "| gate_validate_compression | LLM-in-the-loop 0-100 quality score for a file's compressed view |",
      "| gate_help | This tool — full docs for any tool |",
      "",
      "Use gate_help with tool='<name>' for full documentation.",
    ].join("\n");

    const tokens = countTextTokens(directory);
    logger.info(`gate_help: directory (${tokens} tokens)`);

    return {
      tool: "directory",
      documentation: directory,
      tokens,
      note: `Tool directory: 10 tools. Use tool='<name>' for full docs.`,
    };
  }

  // Specific tool docs
  const docs = TOOL_DOCS[tool];
  if (!docs) {
    const available = Object.keys(TOOL_DOCS).join(", ");
    return {
      tool,
      documentation: `Unknown tool: "${tool}". Available: ${available}`,
      tokens: 0,
      note: `Tool "${tool}" not found.`,
    };
  }

  const tokens = countTextTokens(docs);
  logger.info(`gate_help: ${tool} (${tokens} tokens)`);

  return {
    tool,
    documentation: docs,
    tokens,
    note: `Full documentation for ${tool} (${tokens} tokens).`,
  };
}
// Last reviewed: 2026-05-15 — verified against v0.3.2 fidelity test suite.
