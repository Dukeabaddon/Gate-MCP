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
Cross-session key-value persistence via JSON file.
Store context, decisions, preferences that survive session restarts.

## Parameters
- action (required): 'read' | 'write' | 'delete' | 'list' | 'clear'
- key (required): Memory key identifier (use '*' for list/clear)
- value (optional): Value to store (required for 'write')
- projectRoot (optional): Project root (default: cwd)

## When to use
- Persist decisions or findings across sessions
- Store user preferences or project conventions
- Cache expensive analysis results
- Storage: .gate-mcp/memory.json in project root`,

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
      "# Gate-MCP Tool Directory (v0.2.0-alpha)",
      "",
      "| Tool | Purpose |",
      "|---|---|",
      "| gate_optimize_image | Compress images via OCR/downscale (76-97% savings) |",
      "| gate_compress_file | AST code compression via tree-sitter (46-94% savings) |",
      "| gate_graph_query | Symbol dependency graph with BFS (93-99% savings) |",
      "| gate_memory | Cross-session key-value persistence |",
      "| gate_dedup_context | SHA-256 session dedup cache (auto-integrated) |",
      "| gate_clean_response | TOON JSON compressor (37-81% savings) |",
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
      note: `Tool directory: 7 tools. Use tool='<name>' for full docs.`,
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
