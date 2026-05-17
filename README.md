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

**Layer 1 — Code Navigation:** Symbol dependency graph (tree-sitter) plus optional **graphify-out** repo map (`graphify_hubs`, `graphify_search`, `graphify_map`). Symbol `search` auto-falls back to `GRAPH_REPORT.md` when there are zero symbol hits.

**Layer 2 — Input Compression:** Files compressed to function signatures, imports, and class definitions across **23 languages** (see Language Support below). SHA-256 dedup prevents repeated reads — backed by a **persistent SQLite cache** (v0.4.0) at `.gate-mcp/cache.db` so hits survive across IDE restarts and concurrent IDEs.

**Layer 3 — Response Cleaning:** JSON responses converted to TOON (Token-Optimized Object Notation) — pipe-delimited tables that LLMs parse perfectly.

**Layer 4 — Output Compression:** Recommended integration with [Caveman](https://github.com/juliusbrussee/caveman) for AI response compression.

## Tools

| # | Tool | What It Does | Savings |
|---|---|---|---|
| 1 | `gate_init` | Project health: graphify map path, dedup DB, MCP slug hint | — |
| 2 | `gate_optimize_image` | OCR text extraction or downscaling | 76–97% |
| 3 | `gate_compress_file` | AST signatures (code) or **structure** (YAML/MD/config) | 46–94% |
| 4 | `gate_graph_query` | Symbol graph + **graphify** map (`graphify_map` / `graphify_search`) | 93–99% |
| 5 | `gate_memory` | Cross-session KV — **SQLite** in `.gate-mcp/cache.db` (JSON fallback) | — |
| 6 | `gate_dedup_context` | SHA-256 content cache — **persistent** (SQLite/WAL) | ~93% on rereads |
| 7 | `gate_session_stats` | Cumulative dedup hits and tokens saved | — |
| 8 | `gate_clean_response` | TOON JSON → pipe-delimited tables | 37–81% |
| 9 | `gate_proxy_tools` / `gate_proxy_call` | Compress other MCP servers' schemas + responses | 70–90% |
| 10 | `gate_validate_compression` | LLM-in-the-loop quality score (mock provider for CI) | — |
| 11 | `gate_help` | Full docs on demand; `tool=recommended_stack` for workflow | 46% schema overhead |

Every tool response includes `originalTokens`, `optimizedTokens`, and `savingsPercent`. When compression **inflates** output, `expanded: true` and savings are **not** reported as positive (no fake “-56% savings”).

**Recommended workflow** (monorepos with nested `graphify-out/`):

1. `gate_init` — confirm graphify path and set `GATE_PROJECT_ROOT` if needed  
2. `gate_graph_query` with `queryType: graphify_map` (map before full `Read`)  
3. `gate_compress_file` with `depth: signature` (Python/TS) or `structure` (YAML/MD)  
4. `gate_session_stats` — cumulative cache savings  

Call `gate_help` with `tool: "recommended_stack"` for the full playbook.

## Language Support

Native tree-sitter AST extraction where grammars match the bundled `tree-sitter` runtime:

| Tier 1 — Core native | Tier 2 — Optional native (same graceful fallback as Tier 1) |
|---|---|
| JavaScript (.js, .jsx, .mjs, .cjs) | PHP (.php) — `tree-sitter-php@0.23.x` (peer ^0.21) |
| TypeScript (.ts, .mts, .cts) | Ruby (.rb) |
| TSX (.tsx) | Kotlin (.kt, .kts) |
| Python (.py, .pyi) | Bash (.sh, .bash, .zsh) |
| Java (.java) | Swift (.swift) — build may fail on some paths (see `astParser` notes) |
| C# (.cs) | |
| C / C++ (.c, .cpp, .h, .hpp, .cc) | |
| Go (.go) | |
| Rust (.rs) | |
| HTML (.html) | |
| CSS (.css, .scss, .less) | |
| JSON (.json, .jsonc) | |

**Regex fallback (Tier 2 surface today):** SQL, Scala, Markdown; plus **Vue**, **Svelte**, and **YAML** — optional `tree-sitter-*` packages exist on npm but their bindings do not yet pair cleanly with `tree-sitter@^0.21` (Vue/YAML) or fail native compile on newer Node (Svelte); see comments in `src/lib/astParser.ts`.

All native parsers are **optional dependencies** — install failures degrade gracefully to regex extraction rather than blocking server startup.

**Not supported:** VB.NET (no maintained tree-sitter parser), Dart (Flutter parser unstable).

## Security

Path-traversal protection: by default, tool calls are restricted to the current project directory.

| Env var | Default | Purpose |
|---|---|---|
| `GATE_PROJECT_ROOT` | `process.cwd()` | Boundary for path arguments |
| `GATE_ALLOW_ANY_PATH` | `0` | Set to `1` to disable boundary (NOT recommended) |
| `GATE_MAX_FILES` | `5000` | Max files indexed by symbol graph (hard cap 50000) |
| `GATE_CACHE_DB` | `<projectRoot>/.gate-mcp/cache.db` | Path to persistent dedup cache DB |
| `GATE_GRAPHIFY_REPORT` | _(auto-discover)_ | Absolute path to `GRAPH_REPORT.md` if not under cwd |

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
      "args": ["-y", "@gatemcp/cli@0.5.5"],
      "env": {
        "GATE_PROJECT_ROOT": "/absolute/path/to/your/repo"
      }
    }
  }
}
```

In Cursor the server may appear as **`user-gatemcp`** (not `gatemcp`) — that is normal.

Restart Cursor. Open the MCP panel (Settings → Features → MCP Servers) to verify the server is connected. Run **`gate_init`** once per workspace.
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

# Test (40 unit tests)
npm test

# AlgoTrading / nested-graphify regression (optional)
npm run validate:algo

# Stress test (85 tests)
npm run stress

# LLM-in-the-loop validation CLI (mock provider, no API key)
node dist/scripts/validate-llm.js src/main.ts

# Start MCP server
npm start
```

## Roadmap

Core product scope is complete. Items below marked **done** ship in this repo; archived ideas are struck through (not planned for the default install path).

- [x] npm publish (`@gatemcp/cli`)
- [x] Proxy mode (`gate_proxy_tools` + `gate_proxy_call`)
- [x] Tier 2 optional native parsers (PHP, Ruby, Kotlin, Bash, Swift; Vue/Svelte/YAML regex fallback when native grammar unavailable)
- [x] SQLite-backed dedup cache (`.gate-mcp/cache.db`)
- [x] SQLite-backed `gate_memory` (same DB file, `memory_entries` table; JSON fallback + one-time `memory.json` migration)
- [x] VS Code snippet pack (`vscode-extension/` — not a Marketplace extension)
- [x] Optional LLM validation tool (`gate_validate_compression` — `mock` default, no local LLM required)
- ~~Leiden community detection~~ — archived (graphify covers repo-level communities; not required for compression)
- ~~Ollama/LiteLLM hybrid routing~~ — archived (optional validation providers only; core pipeline needs no local LLM)
- ~~Tool-result cache~~ — archived (dedup + proxy TOON cover repeat reads; no separate store planned)

## Changelog

<details open>
<summary><strong>v0.5.5</strong> — Honest metrics, <code>gate_init</code>, YAML structure mode</summary>

**Metrics.** `expanded: true` when compressed output is larger than raw; `savingsPercent` never fakes positive savings. Dedup stats clamp negative “tokens saved”. `graphify_map` sets `originalTokens` from full `GRAPH_REPORT.md`.

**Compression.** `gate_compress_file` depth `structure` for YAML/Markdown/JSON; auto-structure for config files; summary on YAML redirects to structure (fixes inflated YAML “savings”).

**New tools.** `gate_init` (health + graphify stale warning + cache path), `gate_session_stats` (cumulative dedup savings).

**Graphify.** `rebuild=true` on `gate_graph_query` runs `graphify update .` when the graphify CLI is on PATH. Stale report warning when report commit ≠ `git HEAD`.

**Tests.** 40 unit tests; `npm run validate:algo` for nested `graphify-out` layouts (e.g. AlgoTrading SMC).

</details>

<details>
<summary><strong>v0.5.3</strong> — Graphify bridge for <code>gate_graph_query</code></summary>

**Graphify integration.** `gate_graph_query` now reads nested `graphify-out/GRAPH_REPORT.md` (auto-discovered by walking up from `projectRoot` / cwd, including paths like `crypto/.../smc/graphify-out/`). New query types: `graphify_hubs`, `graphify_search`, `graphify_map`.

**Fallback.** Symbol `search` with 0 hits appends graphify results when a report exists — fixes “0 hits” when agents query community/hub names.

**Response metadata.** `indexedRoot`, `graphifyReport`, `source` (`symbol` | `graphify` | `symbol+graphify`) on tool results.

**Tests.** 5 new unit tests (fixture + live AlgoTrading SMC when present). **35** total.

</details>

<details>
<summary><strong>v0.5.2</strong> — SQLite-backed <code>gate_memory</code></summary>

**Memory.** `gate_memory` now stores KV pairs in **`memory_entries`** inside the same `.gate-mcp/cache.db` as dedup (WAL, concurrent IDE-safe). If `better-sqlite3` is unavailable, behavior falls back to **`memory.json`**. Existing `memory.json` is imported once and renamed to `memory.json.migrated`.

**Limits.** Up to 2,000 keys or ~10 MB total value size (LRU eviction) — tuned for agent notes, not file bodies.

**Cons vs JSON-only:** requires optional native module for SQLite path; first open may migrate JSON; both dedup and memory share one DB file (simpler backup, single lock domain).

</details>

<details>
<summary><strong>v0.5.1</strong> — Tier-2 optional tree-sitter grammars + VS Code snippet pack</summary>

**Optional native parsers** (pinned for `tree-sitter@^0.21` peers): `tree-sitter-php`, `tree-sitter-ruby`, `tree-sitter-kotlin`, `tree-sitter-bash`, `tree-sitter-swift`. Vue / Svelte / YAML packages remain optional installs for forward compatibility; loaders stay disabled where NAN bindings or native compile break against the bundled runtime (details in `src/lib/astParser.ts`).

**VS Code:** `vscode-extension/` — JSON snippets (`gatemcp-mcp`, `gatemcp-cursor-mcp`) plus README task template for `npx -y @gatemcp/cli`.

**Tests:** Stress suite exercises `test-fixtures/tier2/*` one path per grammar; assertions run only when the optional grammar loads.

**LLM validation.** `gate_validate_compression` (modes: `prompts` | `score` | `run`) plus CLI `node dist/scripts/validate-llm.js <file>`. Default provider `mock` needs no API key; `ollama` / `openai` optional. Four unit tests (perfect mock 100/100, faulty mock ~27/100).

</details>

## Known limitations

| Area | Behavior |
|------|----------|
| **gate graph vs graphify** | Symbol index (tree-sitter) ≠ `graphify-out/` community graph. Use `graphify_*` query types for map/hubs; symbol `search` auto-fallback when 0 hits. Nested `graphify-out/` (e.g. `crypto/.../smc/`) auto-discovered. |
| **Graph savings %** | Symbol queries: rough `fileCount × 800` upper bound. **graphify_map**: baseline is full `GRAPH_REPORT.md` token count — comparable to reading the report file. |
| **Cursor MCP name** | Server may show as `user-gatemcp`; use `gate_init` / `gate_help` to confirm wiring. |
| **YAML / config** | Use `depth: structure` (or default signature on `.yaml`) — avoid `summary` on config files. |
| **Flow detection** | `.js` files with `@flow` / `@noflow` anywhere in the first 4KB route to the TSX grammar (heuristic; rare comment false positives possible). |
| **Image auto mode** | OCR confidence 30–70% defaults to **visual** (resize), not text extraction — terminal screenshots may stay as images. |
| **Memory fallback** | Without `better-sqlite3`, `gate_memory` uses `.gate-mcp/memory.json` (no cross-IDE WAL). Install optional dep or use same machine build for SQLite path. |
| **Tier 2 grammars** | Vue / Svelte / YAML optional deps may not load on all platforms; regex fallback still applies. |

<details>
<summary><strong>v0.5.0</strong> — proxy mode: compress your other MCP servers' schemas (70-90% MCP-overhead savings)</summary>

Available on npm as `@gatemcp/cli@0.5.0` — `npm install -g @gatemcp/cli` will land this version.

</details>

<details>
<summary><strong>v0.5.0 details</strong> — full notes</summary>

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
