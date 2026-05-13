# 🚪 Gate-MCP

**Context compression gateway for AI IDEs — save input tokens before they hit the API.**

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-green.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-stdio-purple.svg)](https://modelcontextprotocol.io)

Gate-MCP is a local MCP (Model Context Protocol) server that compresses images, code files, and context **before** they consume your token budget. Includes session-level deduplication (our equivalent of provider prefix caching). One server. Five IDEs. Zero cloud dependencies.

---

## The Problem

As of 2026, AI coding assistants are rate-limited even on Pro plans. The dominant costs are **input tokens**, not output:

| Source | Typical Cost | With Gate-MCP |
|---|---|---|
| Retina screenshot | 1,500–3,000 tokens | ~50 tokens (OCR) |
| 500-line TypeScript file | ~2,000 tokens | ~200 tokens (signatures) |
| Repeated file read (same session) | ~2,000 tokens again | ~15 tokens (dedup cache) |
| Multiple MCP tool schemas | 30,000+ tokens | Roadmap: lazy loading |

**Gate-MCP measures everything.** Every response includes `originalTokens`, `optimizedTokens`, and `savingsPercent`.

---

## Quick Start

```bash
# Clone and install
git clone https://github.com/YOUR_USER/gate-mcp.git
cd gate-mcp
npm install --legacy-peer-deps

# Build
npm run build

# Test
npm test

# Run (stdio mode — used by IDEs)
node dist/main.js
```

---

## Tools

### 🖼️ `gate_optimize_image`
Compress image inputs via OCR text extraction or downscaling.

```json
{
  "imagePath": "/path/to/screenshot.png",
  "intent": "auto"
}
```

| Intent | Behavior | Typical Savings |
|---|---|---|
| `auto` | OCR confidence check → decides text vs visual | 60-95% |
| `text` | Extract text via OCR, discard image | 90-98% |
| `visual` | Downscale to 512px, 80% JPEG quality | 50-75% |

### 📄 `gate_compress_file`
Reduce code file tokens via AST signature extraction.

```json
{
  "filePath": "/path/to/utils.ts",
  "depth": "signature"
}
```

| Depth | Behavior | Typical Savings |
|---|---|---|
| `signature` | Functions, classes, imports, exports only | 70-90% |
| `summary` | First 50 + last 20 lines + signatures | 40-60% |
| `full` | No compression (passthrough) | 0% |

Supports: JavaScript, TypeScript, Python (via tree-sitter). Other languages use regex fallback.

Files are **automatically cached** on first read — subsequent reads of unchanged files are served from the dedup cache (see `gate_dedup_context`).

### 🔄 `gate_dedup_context`
Session-level content deduplication — our equivalent of provider prefix caching, but at the MCP tool layer.

```json
{
  "action": "stats"
}
```

| Action | Behavior | Use Case |
|---|---|---|
| `check` | Look up file in session cache by content hash | Pre-flight check |
| `store` | Cache compressed content for future dedup | After manual compression |
| `stats` | View cache analytics (entries, hits, tokens saved) | Monitoring |
| `clear` | Reset session cache | Start fresh |

**How it works:** First `gate_compress_file` call caches the result with a SHA-256 hash. Subsequent calls detect unchanged files and return cached content — saving ~93% vs re-processing. The cache persists for the lifetime of the MCP server process (one IDE session).

### 🔮 `gate_graph_query`
Symbol dependency graph — maps cross-file imports, functions, classes, and exports. Our Graphify equivalent for code files, built with the same tree-sitter AST, but running in-process (no Python, no CLI, no 2M limit).

```json
{
  "query": "handleCompressFile",
  "queryType": "depends_on"
}
```

| Query Type | Behavior | Use Case |
|---|---|---|
| `search` | Find symbols by name (fuzzy match) | "Where is X defined?" |
| `depends_on` | BFS: what does X import/use? | Impact analysis |
| `dependents` | Reverse BFS: what uses X? | Refactoring safety |
| `file_symbols` | List all symbols in a file | File overview |
| `stats` | Graph overview (nodes, edges, build time) | Monitoring |

**Benchmarks (this project — 14 files):**
| Query | Response Tokens | vs Raw File Read | Savings |
|---|---|---|---|
| stats | 76 tokens | 11,200 tokens | **99%** |
| search "handleCompressFile" | 103 tokens | 11,200 tokens | **99%** |
| depends_on "main.ts" | 730 tokens | 11,200 tokens | **93%** |

Built in **52ms**. Cached after first build — subsequent queries are instant.

> **Gate-MCP vs Graphify:** We handle code files only (JS/TS/Python). Graphify also handles docs, PDFs, images, and videos (using AI API). For code-only projects, Gate-MCP is simpler and faster. For full knowledge graphs, use both together.

### 🧠 `gate_memory` (Phase 2)
Cross-session project memory via JSON persistence. Currently returns roadmap info.

---

## IDE Setup

Replace `/absolute/path/to/gate-mcp/dist/main.js` with the actual path on your system.

<details>
<summary>🖱️ <strong>Cursor</strong></summary>

Create `.cursor/mcp.json` in your project root:
```json
{
  "mcpServers": {
    "gate": {
      "command": "node",
      "args": ["/absolute/path/to/gate-mcp/dist/main.js"]
    }
  }
}
```
</details>

<details>
<summary>🌊 <strong>Windsurf</strong></summary>

Edit `~/.codeium/windsurf/mcp_config.json`:
```json
{
  "mcpServers": {
    "gate": {
      "command": "node",
      "args": ["/absolute/path/to/gate-mcp/dist/main.js"]
    }
  }
}
```
</details>

<details>
<summary>🚀 <strong>Antigravity</strong></summary>

Create `.antigravity/mcp.json` in your project root:
```json
{
  "mcpServers": {
    "gate": {
      "command": "node",
      "args": ["/absolute/path/to/gate-mcp/dist/main.js"],
      "env": {
        "DISABLE_CONSOLE_OUTPUT": "true"
      }
    }
  }
}
```
> ⚠️ The `DISABLE_CONSOLE_OUTPUT` env var is **critical** for Antigravity — it prevents log output from corrupting the JSON-RPC transport.
</details>

<details>
<summary>🤖 <strong>Claude Code</strong></summary>

Edit `~/.claude/mcp.json`:
```json
{
  "mcpServers": {
    "gate": {
      "command": "node",
      "args": ["/absolute/path/to/gate-mcp/dist/main.js"]
    }
  }
}
```
</details>

<details>
<summary>💻 <strong>VS Code Copilot</strong></summary>

Create `.vscode/mcp.json` in your project root:
```json
{
  "servers": {
    "gate": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/gate-mcp/dist/main.js"]
    }
  }
}
```
> Note: VS Code uses `"servers"` key (not `"mcpServers"`).
</details>

---

## Benchmarks (Measured)

### Image Optimization
| Mode | Original | Optimized | Savings |
|---|---|---|---|
| Auto (visual) | 2,765 tokens | 174 tokens | **94%** |
| Text (OCR) | 2,765 tokens | 95 tokens | **97%** |
| Visual (downscale) | 2,765 tokens | 174 tokens | **94%** |

### File Compression (signature mode)
| File | Original | Optimized | Savings |
|---|---|---|---|
| main.ts (MCP server) | 1,794 | 166 | **91%** |
| astParser.ts (tree-sitter) | 2,054 | 286 | **86%** |
| dedupContext.ts (dedup cache) | 2,038 | 231 | **89%** |
| imageProcessor.ts | 1,400 | 334 | **76%** |
| Python sample | 101 | 84 | **17%** |

### Session Dedup Cache
| Scenario | Without Dedup | With Dedup | Savings |
|---|---|---|---|
| Second read of same file | ~150 tokens (re-compress) | ~15 tokens (cache stub) | **~93%** |
| 10 re-reads in a session | ~1,500 tokens total | ~150 tokens total | **90%** |
| 20-turn session (est.) | ~6,000 tokens on re-reads | ~300 tokens | **95%** |

---

## Enterprise Tech Comparison

How Gate-MCP compares to enterprise solutions:

| Enterprise Tech | What It Does | Gate-MCP Equivalent | Status |
|---|---|---|---|
| DeepSeek-OCR | Document → text (10-26x savings) | `gate_optimize_image` (tesseract.js) | ✅ Done |
| LLMLingua (Microsoft) | ML-based prompt compression | `gate_compress_file` (AST, rule-based) | ✅ Done |
| Provider prompt caching | 90% on repeated prefixes | `gate_dedup_context` (session hash cache, ~93%) | ✅ Done |
| Graphifyy | BFS graph query (2k vs 670k tokens) | `gate_graph_query` (symbol dep graph, 93% savings) | ✅ Done |
| mcp-compressor (Atlassian) | Lazy schema loading | `gate_shrink_tools` | 📋 Phase 3 |
| TOON (MindStudio) | Strip JSON bloat | `gate_clean_response` | 📋 Phase 3 |

---

## Maximum Token Savings (Combine All Three)

Gate-MCP compresses **inputs** (Layer 2). For maximum savings, pair it with tools that handle the other layers:

```
Layer 1: NAVIGATION — Gate-MCP graph / Graphify (93-99% — pick the right symbols)
Layer 2: INPUT      — Gate-MCP compress + dedup (91-97% — compress files/images)  ← You are here
Layer 3: OUTPUT     — Caveman Mode (60-75% — compress AI responses)

Combined: ~99.9% total savings on codebase navigation
```

<details>
<summary>🦴 <strong>Caveman Mode</strong> (Output Compression — Free)</summary>

Add this to your AI assistant's system prompt to reduce output tokens by 60-75%:

```
IMPORTANT: Respond in "caveman mode" — use only essential nouns, verbs, and
keywords. No filler words, no preambles, no politeness. Be maximally concise.
Example: Instead of "I would be happy to help you fix the authentication
issue by adding an expiration check", say "Auth middleware: add expiration
check. Fix."
```

No tools required — just a prompt. Works in every IDE.
</details>

<details>
<summary>📊 <strong>Graphify</strong> (Navigation Compression — 71.5× savings)</summary>

[Graphify](https://github.com/safishamsi/graphify/) (47.5K ⭐) builds a knowledge graph of your codebase. Instead of the AI reading 500 files (670K tokens), it queries the graph (2K tokens).

```bash
# Install
pip install graphifyy  # or: pipx install graphifyy
graphify install

# Build graph
/graphify .

# Install for your IDE
graphify antigravity install  # or: graphify cursor install
```

Gate-MCP and Graphify are **complementary**: Graphify finds the right files, Gate-MCP compresses them.
</details>

---

## Roadmap

| Phase | Version | Features |
|---|---|---|
| ✅ Phase 1 | v0.1 | Image optimization, file compression |
| ✅ Phase 1.5 | v0.2-alpha | Session dedup cache, symbol dependency graph |
| 🔄 Phase 2 | v0.2 | Cross-session memory, more languages, Graphify graph.json reader |
| 📋 Phase 3 | v0.3 | Tool schema compression, PDF extraction, response cleaning |

---

## Architecture

```
gate-mcp/
├── src/
│   ├── main.ts              # MCP server + 5 tool registrations
│   ├── tools/
│   │   ├── optimizeImage.ts  # Image → OCR text or downscaled JPEG
│   │   ├── compressFile.ts   # Code → AST signatures (auto-caches)
│   │   ├── dedupContext.ts   # Session dedup cache (provider caching equiv)
│   │   ├── graphQuery.ts     # Symbol dependency graph (BFS queries)
│   │   └── memory.ts         # Stub (Phase 2 — JSON persistence)
│   ├── lib/
│   │   ├── symbolGraph.ts    # In-memory graph engine (tree-sitter + BFS)
│   │   ├── imageProcessor.ts # sharp/jimp + tesseract.js
│   │   ├── astParser.ts      # tree-sitter multi-language
│   │   ├── tokenCounter.ts   # Image + text token estimation
│   │   └── logger.ts         # console.error-only wrapper
│   └── types.ts
```

---

## Known Limitations

- Image optimization requires the image as a file on disk (no clipboard interception)
- File compression supports JS, TS, Python in v0.1; others use regex fallback
- Token counts are estimates (±15% vs actual API billing)
- OCR quality depends on image clarity; low-confidence falls back to visual mode
- `sharp` requires native bindings; `jimp` fallback is slower but always works

---

## Troubleshooting

See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) for:
- sharp installation issues
- OCR confidence tuning
- IDE-specific configuration
- tree-sitter build errors

---

## License

MIT — see [LICENSE](LICENSE) for details.
