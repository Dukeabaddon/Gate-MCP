<p align="center">
  <h1 align="center">🚪 Gate-MCP</h1>
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

---

## The Problem

As of 2026, AI coding assistants waste **80–90% of context window** on:

| Waste Source | Tokens Burned | Gate-MCP Savings |
|---|---|---|
| MCP tool definitions (10 servers) | ~30,000 per turn | **90%** (terse schemas + lazy docs) |
| Reading source files | ~2,000 per file | **46–94%** (AST signatures only) |
| Re-reading unchanged files | Full cost again | **~93%** (SHA-256 dedup cache) |
| JSON API responses | ~5,000 per response | **37–81%** (TOON tabular notation) |
| Screenshots / images | ~1,500–3,000 each | **76–97%** (OCR text extraction) |

Gate-MCP is a single local MCP server that compresses at **5 layers simultaneously** — something no other tool does.

## Installation

```bash
npm install -g gate-mcp
```

Or run directly:

```bash
npx gate-mcp
```

## How It Works

Gate-MCP compresses at 5 layers of the MCP pipeline:

```
                        ┌──────────────────────────┐
                        │    YOUR AI ASSISTANT      │
                        │  (Cursor / Claude Code /  │
                        │   Windsurf / Antigravity) │
                        └─────────┬────────────────┘
                                  │
                     ┌────────────▼────────────────┐
                     │      🚪 GATE-MCP             │
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

**Layer 2 — Input Compression:** Files compressed to function signatures, imports, and class definitions. SHA-256 dedup prevents repeated reads.

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

## Benchmarks

### Validated on Real Codebases

| Test | Target | Result |
|---|---|---|
| **Scale** | VSCode source (6,115 TS files) | 3.2s build, 8ms queries, 25MB RAM |
| **Semantic Quality** | API surface retention after AST compression | **100%** (21/21 exports, 49/49 imports) |
| **TOON Fidelity** | Parse compressed data back to original | **100%** (17/17 fields, 15/15 values) |

### Per-Turn Token Savings

```
Typical AI coding session (before):
  Tool schemas:     30,000 tokens
  File reads (5):   10,000 tokens
  JSON responses:    5,000 tokens
  ─────────────────────────────
  Total:            45,000 tokens

With Gate-MCP:
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
    "gate": {
      "command": "npx",
      "args": ["-y", "gate-mcp"]
    }
  }
}
```

Or if installed globally:

```json
{
  "mcpServers": {
    "gate": {
      "command": "gate-mcp"
    }
  }
}
```

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
│   ├── main.ts              # MCP server (stdio transport, 7 tools)
│   ├── tools/
│   │   ├── compressFile.ts   # L2 — AST signature extraction
│   │   ├── graphQuery.ts     # L1 — Symbol dependency graph
│   │   ├── cleanResponse.ts  # L3 — TOON notation converter
│   │   ├── optimizeImage.ts  # L2 — OCR + image downscaling
│   │   ├── dedupContext.ts   # L2 — SHA-256 content cache
│   │   ├── memory.ts         # Cross-session persistence
│   │   └── help.ts           # L0 — Documentation registry
│   └── lib/
│       ├── symbolGraph.ts    # In-memory adjacency list engine
│       ├── astParser.ts      # tree-sitter AST extraction
│       ├── tokenCounter.ts   # Token estimation
│       └── logger.ts         # Structured logging
├── documentation/            # Hackathon context docs
├── package.json
└── tsconfig.json
```

**Total: ~1,620 LOC · 63 tests · 0 failures**

## Tech Stack

- **Runtime:** Node.js + TypeScript (ESM)
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **AST:** tree-sitter (TypeScript, JavaScript, Python)
- **Image:** sharp + tesseract.js
- **Validation:** Zod
- **Dependencies:** 10 (zero cloud, zero ML models)

## Comparison

| Feature | Gate-MCP | Graphify | Caveman | mcp-compressor |
|---|---|---|---|---|
| Layers compressed | **4+** | 1 (nav) | 1 (output) | 1 (schema) |
| Installation | `npm i -g` | `pip install` | System prompt | npm |
| Cloud required | No | No | No | No |
| ML models needed | No | No | No | No |
| Languages | TS/JS/Python | 25+ | Any | Any |
| Codebase size | 1.6K LOC | 252K LOC | ~100 lines | ~500 LOC |

Gate-MCP is the only tool that compresses at **all input-side layers** in a single binary.

## Development

```bash
# Build
npm run build

# Test (13 unit tests)
npm test

# Stress test (50 tests)
npm run stress

# Start MCP server
npm start
```

## Roadmap

- [ ] npm publish
- [ ] Go, Java, Rust language support
- [ ] Proxy mode (compress any MCP server's schemas)
- [ ] LLM-in-the-loop validation experiment
- [ ] VS Code extension for one-click install
- [ ] Leiden community detection for architecture analysis

## License

MIT

---

<p align="center">
  <sub>Built for developers who are tired of hitting rate limits.</sub>
</p>
