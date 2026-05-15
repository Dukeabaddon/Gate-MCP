<p align="center">
  <h1 align="center">🚪 gatemcp</h1>
  <p align="center">
    <strong>Context compression gateway for AI coding assistants</strong><br/>
    Save 37–99% of input tokens before they hit the API
  </p>
  <p align="center">
    <a href="#installation">Install</a> •
    <a href="#how-it-works">How It Works</a> •
    <a href="#tools">Tools</a> •
    <a href="#benchmarks">Benchmarks</a> •
    <a href="#usage">Usage</a>
  </p>
</p>

> **Note (v0.3.1):** P1 hotfix — tree-sitter's Node binding has a ~32 KB string-buffer limit that silently degraded all JS/TS files >32 KB to regex fallback. Fixed via chunk-callback parsing. Verified on the full Facebook React monorepo (2,080 files, 3.93M → 306k tokens, **92% reduction**) with zero AST failures.
>
> **Note (v0.3.0):** This project was originally named `gate-mcp`. That npm name was claimed by Gate.io's crypto-trading MCP server. The package was renamed to **`gatemcp`** to avoid the collision.

---

## The Problem

As of 2026, AI coding assistants waste **80–90% of context window** on:

| Waste Source | Tokens Burned | gatemcp Savings |
|---|---|---|
| MCP tool definitions (10 servers) | ~30,000 per turn | **90%** (terse schemas + lazy docs) |
| Reading source files | ~2,000 per file | **46–94%** (AST signatures only) |
| Re-reading unchanged files | Full cost again | **~93%** (SHA-256 dedup cache) |
| JSON API responses | ~5,000 per response | **37–81%** (TOON tabular notation) |
| Screenshots / images | ~1,500–3,000 each | **76–97%** (OCR text extraction) |

gatemcp is a single local MCP server that compresses at **5 layers simultaneously** — something no other tool does.

## Installation

```bash
# Once published:
npm install -g gatemcp

# Until then, local install:
git clone https://github.com/Dukeabaddon/Gate-MCP.git
cd Gate-MCP && npm install --legacy-peer-deps && npm run build
```

## How It Works

gatemcp compresses at 5 layers of the MCP pipeline:

```
                        ┌──────────────────────────┐
                        │    YOUR AI ASSISTANT      │
                        │  (Cursor / Claude Code /  │
                        │   Windsurf / Antigravity) │
                        └─────────┬────────────────┘
                                  │
                     ┌────────────▼────────────────┐
                     │      🚪 gatemcp              │
                     │                              │
                     │  L0  Schema    → 46% saved   │
                     │  L1  Navigate  → 93-99%      │
                     │  L2  Input     → 46-94%      │
                     │  L3  Response  → 37-81%      │
                     │  L4  Output    → 60-75%*     │
                     │                              │
                     │  * L4 via Caveman (external) │
                     └────────────────────────────────┘
```

**Layer 0 — Schema Compression:** Tool descriptions are terse one-liners. Full docs served on demand via `gate_help`.

**Layer 1 — Code Navigation:** Instead of reading files (~2,000 tokens each), query a symbol dependency graph (~50 tokens per query). Built with tree-sitter AST.

**Layer 2 — Input Compression:** Files compressed to function signatures, imports, and class definitions across **23 languages** (see Language Support below). SHA-256 dedup prevents repeated reads.

**Layer 3 — Response Cleaning:** JSON responses converted to TOON (Token-Optimized Object Notation) — pipe-delimited tables that LLMs parse perfectly.

**Layer 4 — Output Compression:** Recommended integration with [Caveman](https://github.com/juliusbrussee/caveman) for AI response compression.

## Tools

| # | Tool | What It Does | Savings |
|---|---|---|---|
| 1 | `gate_optimize_image` | OCR text extraction or downscaling | 76–97% |
| 2 | `gate_compress_file` | AST signature extraction (tree-sitter) | 46–94% |
| 3 | `gate_graph_query` | Symbol dependency graph with BFS traversal | 93–99% |
| 4 | `gate_memory` | Cross-session key-value persistence | — |
| 5 | `gate_dedup_context` | SHA-256 content deduplication cache | ~93% on rereads |
| 6 | `gate_clean_response` | TOON JSON → pipe-delimited tables | 37–81% |
| 7 | `gate_help` | Full documentation on demand | 46% schema overhead |

Every tool response includes `originalTokens`, `optimizedTokens`, and `savingsPercent`. No vague claims.

## Language Support (v0.3.0)

Native tree-sitter AST extraction — full signature parsing:

| Tier 1 — Native AST | Tier 2 — Regex fallback |
|---|---|
| JavaScript (.js, .jsx, .mjs, .cjs) | SQL (.sql) |
| TypeScript (.ts, .mts, .cts) | PHP (.php) |
| TSX (.tsx) — JSX-aware grammar | Ruby (.rb) |
| Python (.py, .pyi) | Kotlin (.kt, .kts) |
| Java (.java) | Swift (.swift) |
| C# (.cs) | Scala (.scala) |
| C / C++ (.c, .cpp, .h, .hpp, .cc) | Vue (.vue) — SFC, body only |
| Go (.go) | Svelte (.svelte) — SFC, body only |
| Rust (.rs) | YAML (.yaml, .yml) |
| HTML (.html) | Bash (.sh, .bash, .zsh) |
| CSS (.css, .scss, .less) | Markdown (.md, .mdx) |
| JSON (.json, .jsonc) | |

**Note:** Tier 2 languages use regex fallback (less accurate but functional) until native parsers are added in v0.4. All Tier 1 parsers are **optional dependencies** — install failures degrade gracefully to regex extraction rather than blocking server startup.

**Not supported:** VB.NET (no maintained tree-sitter parser), Dart (Flutter parser unstable).

## Security

v0.3.0 adds path-traversal protection. By default, tool calls are restricted to the current project directory.

| Env var | Default | Purpose |
|---|---|---|
| `GATE_PROJECT_ROOT` | `process.cwd()` | Boundary for path arguments |
| `GATE_ALLOW_ANY_PATH` | `0` | Set to `1` to disable boundary (NOT recommended) |
| `GATE_MAX_FILES` | `5000` | Max files indexed by symbol graph (hard cap 50000) |

Sensitive paths (`~/.ssh`, `~/.aws/credentials`, `/etc/passwd`, etc) are blocked regardless of boundary.

## Benchmarks

### Validated on Real Codebases

| Test | Target | Result |
|---|---|---|
| **Scale** | VSCode source (6,115 TS files) | 3.2s build, 8ms queries, 25MB RAM |
| **Semantic Quality** | API surface retention after AST compression | **100%** (21/21 exports, 49/49 imports) |
| **TOON Fidelity** | Parse compressed data back to original | **100%** (17/17 fields, 15/15 values) |
| **React monorepo** (v0.3.1) | `facebook/react` `packages/` — 2,080 files, 3.93M tokens | **92% reduction → 306k tokens** ($10.87 saved per Claude Sonnet 4 query) |
| **React DOM** (v0.3.1) | `react-dom/src` — 185 files, 786k tokens | **96% reduction → 30k tokens** |
| **React Reconciler** (v0.3.1) | `react-reconciler/src` — 165 files, 793k tokens | **92% reduction → 62k tokens** |

Reproduce the React benchmarks with:

```bash
git clone --depth 1 https://github.com/facebook/react ~/demo/react
node dist/scripts/benchmark-real-repo.js ~/demo/react/packages --out report.md
```

### Per-Turn Token Savings

```
Typical AI coding session (before):
  Tool schemas:     30,000 tokens
  File reads (5):   10,000 tokens
  JSON responses:    5,000 tokens
  ─────────────────────────────
  Total:            45,000 tokens

With gatemcp:
  Tool schemas:      3,000 tokens  (gate_help)
  File reads (5):      600 tokens  (AST signatures)
  JSON responses:    1,500 tokens  (TOON)
  ─────────────────────────────
  Total:             5,100 tokens

  Savings: ~89%
```

## Usage

### Configure Your AI IDE

Add to your MCP config (works with Cursor, Windsurf, Claude Code, Antigravity, VS Code Copilot):

```json
{
  "mcpServers": {
    "gatemcp": {
      "command": "node",
      "args": ["/absolute/path/to/Gate-MCP/dist/main.js"]
    }
  }
}
```

Per-IDE config locations:
- **Cursor:** `.cursor/mcp.json` in workspace
- **Windsurf:** `~/.codeium/windsurf/mcp_config.json`
- **Claude Code:** `~/.claude/mcp.json`
- **Antigravity:** `.antigravity/mcp.json` — also requires `MCP_MODE=stdio` + `DISABLE_CONSOLE_OUTPUT=true`
- **VS Code Copilot:** `.vscode/mcp.json` — uses `"servers"` key, not `"mcpServers"`

### Example: Compress a File

```
User: Read src/main.ts
AI uses: gate_compress_file({ filePath: "src/main.ts", depth: "signature" })

Result:
  originalTokens: 2,664
  optimizedTokens: 191
  savingsPercent: 93%
  content: [imports, function signatures, class definitions]
```

### Example: Navigate Code Without Reading Files

```
User: What depends on handleCompressFile?
AI uses: gate_graph_query({ query: "handleCompressFile", queryType: "dependents" })

Result:
  traversed: 108 nodes
  responseTokens: 762
  rawReadTokens: 15,200 (if files were read directly)
  savingsPercent: 95%
```

### Example: Compress JSON Responses

```
User: List all users
AI uses: gate_clean_response({
  data: '[{"id":1,"name":"Alice","role":"admin"},{"id":2,"name":"Bob","role":"user"}]',
  format: "toon"
})

Result:
  id|name|role
  1|Alice|admin
  2|Bob|user
  Savings: 37%
```

## Architecture

```
gate-mcp/
├── src/
│   ├── main.ts              # MCP server (stdio, 7 tools, SIGINT-aware)
│   ├── tools/
│   │   ├── compressFile.ts   # L2 — AST signature extraction
│   │   ├── graphQuery.ts     # L1 — Symbol dependency graph
│   │   ├── cleanResponse.ts  # L3 — TOON notation converter
│   │   ├── optimizeImage.ts  # L2 — OCR + image downscaling
│   │   ├── dedupContext.ts   # L2 — SHA-256 content cache
│   │   ├── memory.ts         # Cross-session persistence
│   │   └── help.ts           # L0 — Documentation registry
│   └── lib/
│       ├── symbolGraph.ts    # Adjacency list + manifest-hash cache
│       ├── astParser.ts      # tree-sitter for 12 langs + regex fallback
│       ├── pathGuard.ts      # Path-traversal protection (v0.3)
│       ├── imageProcessor.ts # sharp/jimp + tesseract.js
│       ├── tokenCounter.ts   # gpt-tokenizer BPE counting
│       └── logger.ts         # stderr-only structured logging
├── documentation/            # FAIROS research docs
├── package.json
└── tsconfig.json
```

**Total: ~4,800 LOC · 13 unit + 53 stress tests · 0 failures**

## Tech Stack

- **Runtime:** Node.js ≥20 + TypeScript ESM
- **MCP SDK:** `@modelcontextprotocol/sdk` ^1.12.1
- **AST:** tree-sitter — 10 native parsers (JS, TS, TSX, Python, Java, C#, C++, Go, Rust, HTML, CSS, JSON) + regex fallback for 11 more
- **Image:** sharp ^0.33 (primary) + jimp 1.6 (fallback) + tesseract.js 5.1
- **Tokens:** gpt-tokenizer ^2.8.1 (real BPE counts, not estimates)
- **Validation:** Zod
- **Dependencies:** 10 core + 8 optional native parsers — zero cloud, zero ML models

## Comparison

| Feature | gatemcp | Graphify | Caveman | mcp-compressor |
|---|---|---|---|---|
| Layers compressed | **4+** | 1 (nav) | 1 (output) | 1 (schema) |
| Installation | `npm i -g` (after publish) | `pip install` | System prompt | npm |
| Cloud required | No | No | No | No |
| ML models needed | No | No | No | No |
| Languages | **12 native + 11 regex** | 25+ | Any | Any |
| Codebase size | ~4.8K LOC | 252K LOC | ~100 lines | ~500 LOC |

gatemcp is the only tool that compresses at **all input-side layers** in a single binary.

## Development

```bash
# Install (with optional parsers)
npm install --legacy-peer-deps

# Build
npm run build

# Test (13 unit tests)
npm test

# Stress test (53 tests)
npm run stress

# Start MCP server
npm start
```

## Roadmap

- [ ] npm publish as `gatemcp`
- [ ] Tier 2 languages: native tree-sitter for PHP, Ruby, Kotlin, Swift, Vue, Svelte, YAML, Bash
- [ ] Proxy mode (compress any MCP server's schemas)
- [ ] LLM-in-the-loop validation experiment
- [ ] VS Code extension for one-click install
- [ ] Leiden community detection for architecture analysis
- [ ] SQLite-backed memory + tool-result cache (v0.4)
- [ ] Ollama/LiteLLM hybrid routing (v0.5)

## License

MIT

---

<p align="center">
  <sub>Built for developers who are tired of hitting rate limits.</sub>
</p>
