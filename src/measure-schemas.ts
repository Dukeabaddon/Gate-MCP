/**
 * Quick measurement: how many tokens do our tool schemas cost?
 * Compares the BEFORE (verbose) vs AFTER (terse) descriptions.
 */

import { countTextTokens } from "./lib/tokenCounter.js";

const VERBOSE_DESCRIPTIONS = [
  "Compress image inputs by extracting text (OCR) or downscaling. Returns token savings metrics. Use intent='text' for screenshots/docs, 'visual' for photos/diagrams, or 'auto' to auto-detect.",
  "Reduce file input tokens by returning AST signatures instead of full source. Supports JS/TS/Python via tree-sitter. depth='signature' (default) extracts functions/classes/imports. depth='summary' returns first 50 + last 20 lines + signatures. depth='full' returns uncompressed content.",
  "Query a symbol dependency graph built from your codebase using tree-sitter AST. Returns cross-file relationships (imports, exports, calls) in <300 tokens instead of reading entire files (>2,000 tokens each). Use queryType='stats' to see graph size, 'search' to find symbols, 'depends_on' to trace dependencies, 'dependents' for reverse lookup, 'file_symbols' to list symbols in a file.",
  "Cross-session project memory via JSON persistence. Store and retrieve key-value context across MCP sessions. Persisted to .gate-mcp/memory.json in the project root.",
  "Session-level content deduplication — our equivalent of provider prefix caching. Automatically integrated into gate_compress_file (files are cached on first read). Use action='stats' to see cache analytics, or action='clear' to reset. Repeated reads of unchanged files cost ~15 tokens instead of 150+.",
  "Compress JSON responses using TOON (Token-Optimized Object Notation). Arrays of objects become pipe-delimited tables (30-98% savings). Modes: 'toon' (tabular), 'compact' (minified JSON), 'whitelist' (keep only specified fields).",
];

const TERSE_DESCRIPTIONS = [
  "Compress images via OCR text extraction or downscaling. 76-97% savings. Use gate_help for full docs.",
  "AST code compression via tree-sitter. Extract signatures, discard implementation. 46-94% savings. Use gate_help for full docs.",
  "Symbol dependency graph with BFS traversal. Find, trace, navigate code without reading files. 93-99% savings. Use gate_help for full docs.",
  "Cross-session key-value persistence to .gate-mcp/memory.json. Use gate_help for full docs.",
  "Session dedup cache. Auto-integrated into gate_compress_file. Use 'stats'/'clear' to manage. Use gate_help for full docs.",
  "TOON JSON compressor. Arrays→pipe tables, 37-81% savings. Modes: toon/compact/whitelist. Use gate_help for full docs.",
  "Full docs for any Gate-MCP tool. Call with tool='<name>' or omit for directory.",
];

const verboseTotal = VERBOSE_DESCRIPTIONS.reduce((sum, d) => sum + countTextTokens(d), 0);
const terseTotal = TERSE_DESCRIPTIONS.reduce((sum, d) => sum + countTextTokens(d), 0);
const savings = Math.round(((verboseTotal - terseTotal) / verboseTotal) * 100);

console.error("═".repeat(50));
console.error("  Schema Token Savings Measurement");
console.error("═".repeat(50));
console.error(`  BEFORE (6 verbose descriptions): ${verboseTotal} tokens`);
console.error(`  AFTER (7 terse descriptions):    ${terseTotal} tokens`);
console.error(`  Savings: ${verboseTotal - terseTotal} tokens (${savings}%)`);
console.error(`  Note: AFTER has 7 tools (added gate_help) but still fewer tokens`);
console.error("═".repeat(50));
// Last reviewed: 2026-05-15 — verified against v0.3.2 fidelity test suite.
