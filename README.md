<p align="center">
  <h1 align="center">🚪 gatemcp</h1>
  <p align="center">
    <strong>Context compression gateway for AI coding assistants</strong><br/>
    Save 37–99% of input tokens before they hit the API
  </p>
  <p align="center">
    <a href="https://gate-mcp-site.vercel.app/"><strong>Website</strong></a> •
    <a href="#installation">Install</a> •
    <a href="#how-it-works">How It Works</a> •
    <a href="#tools">Tools</a> •
    <a href="#benchmarks">Benchmarks</a> •
    <a href="#usage">Usage</a> •
    <a href="#changelog">Changelog</a>
  </p>
</p>

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
npm install -g @gatemcp/cli
```

Or use directly via npx (no install needed):

```bash
npx -y @gatemcp/cli
```

The npm package is `@gatemcp/cli` (scoped under the [@gatemcp](https://www.npmjs.com/org/gatemcp) org) but the installed CLI binary is just `gatemcp`. All IDE configs below use `npx -y @gatemcp/cli` so there's nothing to install globally if you don't want to.

<details>
<summary><strong>Install from source (if you prefer)</strong></summary>

```bash
git clone https://github.com/Dukeabaddon/Gate-MCP.git
cd Gate-MCP
npm install --legacy-peer-deps
npm run build
npm link   # makes "gatemcp" available system-wide
```

</details>

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

**Layer 2 — Input Compression:** Files compressed to function signatures, imports, and class definitions across **23 languages** (see Language Support below). SHA-256 dedup prevents repeated reads — backed by a **persistent SQLite cache** (v0.4.0) at `.gate-mcp/cache.db` so hits survive across IDE restarts and concurrent IDEs.

**Layer 3 — Response Cleaning:** JSON responses converted to TOON (Token-Optimized Object Notation) — pipe-delimited tables that LLMs parse perfectly.

**Layer 4 — Output Compression:** Recommended integration with [Caveman](https://github.com/juliusbrussee/caveman) for AI response compression.

## Tools

| # | Tool | What It Does | Savings |
|---|---|---|---|
| 1 | `gate_optimize_image` | OCR text extraction or downscaling | 76–97% |
| 2 | `gate_compress_file` | AST signature extraction (tree-sitter) | 46–94% |
| 3 | `gate_graph_query` | Symbol dependency graph with BFS traversal | 93–99% |
| 4 | `gate_memory` | Cross-session key-value persistence | — |
| 5 | `gate_dedup_context` | SHA-256 content cache — **persistent** across sessions (v0.4.0, SQLite/WAL, in-memory fallback) | ~93% on rereads |
| 6 | `gate_clean_response` | TOON JSON → pipe-delimited tables | 37–81% |
| 7 | `gate_help` | Full documentation on demand | 46% schema overhead |

Every tool response includes `originalTokens`, `optimizedTokens`, and `savingsPercent`. No vague claims.

## Language Support

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

All Tier 1 parsers are **optional dependencies** — install failures degrade gracefully to regex extraction rather than blocking server startup.

**Not supported:** VB.NET (no maintained tree-sitter parser), Dart (Flutter parser unstable).

## Security

Path-traversal protection: by default, tool calls are restricted to the current project directory.

| Env var | Default | Purpose |
|---|---|---|
| `GATE_PROJECT_ROOT` | `process.cwd()` | Boundary for path arguments |
| `GATE_ALLOW_ANY_PATH` | `0` | Set to `1` to disable boundary (NOT recommended) |
| `GATE_MAX_FILES` | `5000` | Max files indexed by symbol graph (hard cap 50000) |
| `GATE_CACHE_DB` | `<projectRoot>/.gate-mcp/cache.db` | Path to persistent dedup cache DB |

Sensitive paths (`~/.ssh`, `~/.aws/credentials`, `/etc/passwd`, etc) are blocked regardless of boundary.

## Benchmarks

### Validated on Real Codebases

| Test | Target | Result |
|---|---|---|
| **Scale** | VSCode source (6,115 TS files) | 3.2s build, 8ms queries, 25MB RAM |
| **Semantic Quality** | API surface retention after AST compression | **100%** (21/21 exports, 49/49 imports) |
| **TOON Fidelity** | Parse compressed data back to original | **100%** (17/17 fields, 15/15 values) |
| **React monorepo** | `facebook/react` `packages/` — 2,080 files, 3.93M tokens | **89% reduction → 446k tokens** ($10.45 saved per Claude Sonnet 4 query) |
| **Symbol-recall fidelity** | 1,010 React files, 7,047 exported symbols | **99.1%** symbols preserved (6,987/7,047) |
| **Per-file perfect recall** | 1,010 React files | **99.3%** files at exact 100% recall (1,003/1,010) |

Reproduce the React benchmarks with:

```bash
git clone --depth 1 https://github.com/facebook/react ~/demo/react

# Token-cost benchmark
node dist/scripts/benchmark-real-repo.js ~/demo/react/packages --out report.md

# Fidelity validation
node dist/scripts/fidelity-test.js ~/demo/react/packages
```

<details>
<summary><strong>Per-Turn Token Savings (worked example)</strong></summary>

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

</details>

## Usage

### Configure your IDE

After `npm install -g gatemcp`, add gatemcp to your IDE's MCP config. Click your IDE below for the exact snippet.

<details>
<summary><strong>Cursor</strong> — <code>.cursor/mcp.json</code> in your workspace</summary>

```json
{
  "mcpServers": {
    "gatemcp": {
      "command": "npx",
      "args": ["-y", "@gatemcp/cli"]
    }
  }
}
```

Restart Cursor. Open the MCP panel (Settings → Features → MCP Servers) to verify `gatemcp` is connected.
</details>

<details>
<summary><strong>Claude Code</strong> — <code>~/.claude/mcp.json</code></summary>

```json
{
  "mcpServers": {
    "gatemcp": {
      "command": "npx",
      "args": ["-y", "@gatemcp/cli"]
    }
  }
}
```

Restart Claude Code. Run `/mcp` inside the CLI to confirm the server is listed.
</details>

<details>
<summary><strong>Windsurf</strong> — <code>~/.codeium/windsurf/mcp_config.json</code></summary>

```json
{
  "mcpServers": {
    "gatemcp": {
      "command": "npx",
      "args": ["-y", "@gatemcp/cli"]
    }
  }
}
```

Restart Windsurf. Open the MCP panel from the Cascade settings to verify.
</details>

<details>
<summary><strong>Antigravity</strong> — <code>.antigravity/mcp.json</code> in your workspace</summary>

```json
{
  "mcpServers": {
    "gatemcp": {
      "command": "npx",
      "args": ["-y", "@gatemcp/cli"],
      "env": {
        "MCP_MODE": "stdio",
        "DISABLE_CONSOLE_OUTPUT": "true"
      }
    }
  }
}
```

Antigravity requires `MCP_MODE=stdio` and `DISABLE_CONSOLE_OUTPUT=true` for clean stdout framing. Restart the agent after editing.
</details>

<details>
<summary><strong>VS Code Copilot</strong> — <code>.vscode/mcp.json</code> in your workspace</summary>

```json
{
  "servers": {
    "gatemcp": {
      "command": "npx",
      "args": ["-y", "@gatemcp/cli"]
    }
  }
}
```

**Note:** VS Code uses `"servers"` (not `"mcpServers"`). Reload the window after saving.
</details>

<details>
<summary><strong>Other MCP-aware tools</strong> (Cline, Zed, Continue.dev, custom)</summary>

Any client that supports MCP over stdio works. The generic invocation is:

```bash
npx -y gatemcp
```

Pass it via your client's MCP config — the command is `npx`, the args are `["-y", "@gatemcp/cli"]`, and gatemcp speaks vanilla stdio MCP. If your client uses a different config key (e.g. `tools.mcpServers`), adapt the wrapping object but keep the inner shape.
</details>

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
│       ├── pathGuard.ts      # Path-traversal protection
│       ├── imageProcessor.ts # sharp/jimp + tesseract.js
│       ├── tokenCounter.ts   # gpt-tokenizer BPE counting
│       ├── cacheDb.ts        # SQLite-backed persistent dedup cache
│       └── logger.ts         # stderr-only structured logging
├── package.json
└── tsconfig.json
```

**Total: ~5,500 LOC · 17 unit + 63 stress tests · 0 failures**

## Tech Stack

- **Runtime:** Node.js ≥20 + TypeScript ESM
- **MCP SDK:** `@modelcontextprotocol/sdk` ^1.12.1
- **AST:** tree-sitter — 12 native parsers (JS, TS, TSX, Python, Java, C#, C++, Go, Rust, HTML, CSS, JSON) + regex fallback for 11 more
- **Image:** sharp ^0.33 (primary) + jimp 1.6 (fallback) + tesseract.js 5.1
- **Tokens:** gpt-tokenizer ^2.8.1 (real BPE counts, not estimates)
- **Cache:** better-sqlite3 ^12 (optional, WAL mode) with in-memory Map fallback
- **Validation:** Zod
- **Dependencies:** 10 core + 9 optional native parsers — zero cloud, zero ML models

## Comparison

| Feature | gatemcp | Graphify | Caveman | mcp-compressor |
|---|---|---|---|---|
| Layers compressed | **4+** | 1 (nav) | 1 (output) | 1 (schema) |
| Installation | `npm i -g` | `pip install` | System prompt | npm |
| Cloud required | No | No | No | No |
| ML models needed | No | No | No | No |
| Languages | **12 native + 11 regex** | 25+ | Any | Any |
| Codebase size | ~5.5K LOC | 252K LOC | ~100 lines | ~500 LOC |

gatemcp is the only tool that compresses at **all input-side layers** in a single binary.

## Development

```bash
# Install (with optional parsers)
npm install --legacy-peer-deps

# Build
npm run build

# Test (17 unit tests)
npm test

# Stress test (63 tests)
npm run stress

# Start MCP server
npm start
```

## Roadmap

- [x] npm publish (shipped as `@gatemcp/cli` v0.4.0)
- [x] Proxy mode (`gate_proxy_tools` + `gate_proxy_call`, v0.5.0 — see notes above)
- [ ] Tier 2 languages: native tree-sitter for PHP, Ruby, Kotlin, Swift, Vue, Svelte, YAML, Bash
- [ ] LLM-in-the-loop validation experiment
- [ ] VS Code extension for one-click install
- [ ] Leiden community detection for architecture analysis
- [x] SQLite-backed dedup cache (v0.4.0 — shipped)
- [ ] SQLite-backed memory + tool-result cache (v0.4.x)
- [ ] Ollama/LiteLLM hybrid routing (v0.5)

## Changelog

<details>
<summary><strong>v0.5.0</strong> — proxy mode: compress your other MCP servers' schemas (70-90% MCP-overhead savings)</summary>

**New tools.** `gate_proxy_tools` and `gate_proxy_call`. Lets gatemcp front-end every other MCP server you have configured (GitHub, Postgres, Filesystem, Linear, etc.) so the LLM sees one compressed catalog instead of paying full schema cost for each server every turn.

**How it works.** Drop a `.gate-mcp/proxy-servers.json` in your project root (same shape as your IDE's MCP config). gatemcp lazily spawns each downstream server as a child stdio MCP client, lists their tools, compresses descriptions + JSON schemas, and exposes them via two thin proxy tools. Responses route back through the same TOON compressor that powers `gate_clean_response`.

**Safety.** Per-call timeout (default 30s, configurable via `GATE_PROXY_TIMEOUT_MS`) so a wedged downstream server cannot starve gatemcp. Wedged connections are dropped on timeout and the next call re-spawns cleanly. Cleanup is non-blocking so the LLM sees the timeout error immediately. Connections are pooled across calls (one spawn per server per session) and torn down on graceful shutdown.

**Test fixture.** Ships with a deterministic mock MCP server (built from source only, excluded from the published tarball) so the test suite covers spawn → list → describe → call → timeout → cleanup end-to-end. 8 new unit tests at 25 total.

Benchmark on a 10-server / 50-tool typical roster: **~70-90%** reduction in per-turn MCP schema overhead. Use `gate_proxy_tools` with `action: 'list'` once per session, then `action: 'describe'` only before invoking a tool the LLM hasn't seen the full schema for yet.

See [`.gate-mcp/proxy-servers.example.json`](./.gate-mcp/proxy-servers.example.json) for a starting config.
</details>

<details>
<summary><strong>v0.4.0</strong> — published to npm as <code>@gatemcp/cli</code> + persistent dedup cache (SQLite/WAL)</summary>

**npm publish.** Available as `npm install -g @gatemcp/cli` (or `npx -y @gatemcp/cli` for zero-install use). Scoped under the [@gatemcp](https://www.npmjs.com/org/gatemcp) organization. The unscoped name `gatemcp` is rejected by npm's similarity check against the pre-existing `gate-mcp` package (Gate.io's crypto MCP) so the scoped name is the canonical distribution name. CLI binary name remains `gatemcp` for terminal use.

**Persistent dedup cache.** The session dedup cache is now **persistent across IDE restarts** and safe for **concurrent IDEs**. The previous in-memory `Map` is replaced with a SQLite database (WAL journal mode, NORMAL synchronous) at `<projectRoot>/.gate-mcp/cache.db` (override with `GATE_CACHE_DB`).

`better-sqlite3` is an **optional** dependency — if the native binary cannot be loaded on your platform, the cache transparently degrades to the original in-memory Map and the server keeps working.

LRU eviction caps the cache at 10,000 entries or 500 MB of content, whichever is hit first.

Benchmark / fidelity numbers are unchanged from v0.3.2 (89% reduction at 99.1% recall on React).
</details>

<details>
<summary><strong>v0.3.2</strong> — 4 P1 fidelity bugs surfaced + fixed</summary>

Four P1 bugs surfaced and fixed while running the first end-to-end benchmark + fidelity validation on the public Facebook React monorepo:

1. tree-sitter's Node binding has a ~32 KB string buffer — fixed via chunk-callback parsing.
2. Flow-typed `.js` files (most of React's codebase) were silently dropping every export — fixed by routing `@flow` files to the TSX grammar.
3. Multi-line `export { A, B, C } from '...'` blocks were truncated to just `export {` — fixed to capture full block.
4. CommonJS `exports.foo = ...` patterns were never recognized — fixed via supplemental scan.

**Honest benchmark on facebook/react (2,080 files, 3.93M tokens):** **89% input-token reduction at 99.1% symbol-recall fidelity** (validated by `dist/scripts/fidelity-test.js`). The pre-v0.3.2 code reported 92% reduction but was secretly dropping ~31% of exported symbols AND duplicating function bodies inside exports — a lossy compression masquerading as semantic.
</details>

<details>
<summary><strong>v0.3.0</strong> — rename from <code>gate-mcp</code> to <code>gatemcp</code></summary>

This project was originally named `gate-mcp`. That npm name was claimed by Gate.io's crypto-trading MCP server. The package was renamed to **`gatemcp`** to avoid the collision.

Also: expanded to 12 native tree-sitter languages, added path-traversal protection, improved graph cache invalidation, fixed OCR worker leak, and made tree-sitter parsers optional dependencies so install failures degrade gracefully.
</details>

## License

MIT

---

<p align="center">
  <a href="https://gate-mcp-site.vercel.app/">Website</a> ·
  <a href="https://github.com/Dukeabaddon/Gate-MCP">GitHub</a> ·
  <a href="https://github.com/Dukeabaddon/Gate-MCP/issues">Issues</a>
</p>

<p align="center">
  <sub>Built for developers who are tired of hitting rate limits.</sub>
</p>
