<p align="center">
  <h1 align="center">🚪 gatemcp</h1>
  <p align="center">
    <strong>Context compression gateway for AI coding assistants</strong><br/>
    Measure and reduce context without hiding fidelity failures
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

Gate targets four common sources of avoidable context. Results depend on the
repository, selected tool, and payload shape:

| Context source | Gate behavior |
|---|---|
| MCP tool definitions | Lazy descriptions and opt-in proxy catalogs |
| Reading source files | AST signatures or bounded structural outlines |
| Re-reading unchanged files | Cached computation plus explicit reference-only checks |
| JSON API responses | TOON tables when the response shape is suitable |
| Screenshots / images | OCR extraction or downscaling |

Gate is an **opt-in local MCP server**. The agent must call Gate tools; Gate does
not intercept ordinary filesystem reads automatically.

## Installation

```bash
npm install -g --strict-allow-scripts \
  --allow-scripts=better-sqlite3,sharp,tesseract.js,tree-sitter,tree-sitter-bash,tree-sitter-c,tree-sitter-c-sharp,tree-sitter-cli,tree-sitter-cpp,tree-sitter-css,tree-sitter-go,tree-sitter-html,tree-sitter-java,tree-sitter-javascript,tree-sitter-json,tree-sitter-kotlin,tree-sitter-php,tree-sitter-python,tree-sitter-ruby,tree-sitter-rust,tree-sitter-svelte,tree-sitter-swift,tree-sitter-typescript,tree-sitter-vue,tree-sitter-yaml \
  @gatemcp/cli
```

Or use the same reviewed build approvals without a global install:

```bash
npm exec --yes --strict-allow-scripts \
  --allow-scripts=better-sqlite3,sharp,tesseract.js,tree-sitter,tree-sitter-bash,tree-sitter-c,tree-sitter-c-sharp,tree-sitter-cli,tree-sitter-cpp,tree-sitter-css,tree-sitter-go,tree-sitter-html,tree-sitter-java,tree-sitter-javascript,tree-sitter-json,tree-sitter-kotlin,tree-sitter-php,tree-sitter-python,tree-sitter-ruby,tree-sitter-rust,tree-sitter-svelte,tree-sitter-swift,tree-sitter-typescript,tree-sitter-vue,tree-sitter-yaml \
  --package=@gatemcp/cli -- gatemcp
```

The npm package is `@gatemcp/cli` but the installed binary is `gatemcp`.
The explicit allowlist is required by npm 12 for reviewed native dependency
builds. Without it, Gate starts with safe fallbacks and strict doctor reports
that SQLite is unavailable. A first native install can take up to one minute.

<details>
<summary><strong>Install from source (if you prefer)</strong></summary>

```bash
git clone https://github.com/Dukeabaddon/Gate-MCP.git
cd Gate-MCP
npm install
npm run build
npm link   # makes "gatemcp" available system-wide
```

</details>

## How It Works

Gate provides four input-side functions. A fifth output-side layer is an
optional external integration:

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
                     │  L0  Lazy schemas            │
                     │  L1  Graph navigation        │
                     │  L2  File compression        │
                     │  L3  Response cleaning       │
                     │  L4  External output layer*  │
                     │                              │
                     │  * L4 via Caveman (external) │
                     └────────────────────────────────┘
```

**Layer 0 — Schema Compression:** Tool descriptions are terse one-liners. Full docs served on demand via `gate_help`.

**Layer 1 — Code Navigation:** Symbol dependency graph (tree-sitter) plus optional **graphify-out** repo map (`graphify_hubs`, `graphify_search`, `graphify_map`). Symbol `search` auto-falls back to `GRAPH_REPORT.md` when there are zero symbol hits.

**Layer 2 — Input Compression:** Files become signatures or structural outlines
across the language surfaces below. Cache identity includes the canonical path,
content hash, requested depth, language, compressor version, and schema version.
SQLite/WAL persistence is used when its native binding opens successfully.

**Layer 3 — Response Cleaning:** Suitable JSON responses are converted to TOON
(Token-Optimized Object Notation). Use validation for fidelity-sensitive data.

**Layer 4 — Output Compression:** Recommended integration with [Caveman](https://github.com/juliusbrussee/caveman) for AI response compression.

## Tools

| # | Tool | What It Does | Savings |
|---|---|---|---|
| 1 | `gate_init` | Project health: graphify map path, dedup DB, MCP slug hint | — |
| 2 | `gate_optimize_image` | OCR text extraction or downscaling | Measured per result |
| 3 | `gate_compress_file` | AST signatures or bounded structure; full fallback when no signal exists | Measured per result |
| 4 | `gate_graph_query` | Symbol graph + **graphify** map (`graphify_map` / `graphify_search`) | Measured or modeled; see limitations |
| 5 | `gate_memory` | Cross-session KV — **SQLite** in `.gate-mcp/cache.db` (JSON fallback) | — |
| 6 | `gate_dedup_context` | Reference-only unchanged check; cached computation for file compression | Measured response |
| 7 | `gate_session_stats` | Serialized-result byte/token accounting plus cache activity | — |
| 8 | `gate_clean_response` | TOON JSON → pipe-delimited tables | Measured per result |
| 9 | `gate_proxy_tools` / `gate_proxy_call` | Opt-in downstream MCP schemas and responses | Measured per result |
| 10 | `gate_validate_compression` | LLM-in-the-loop quality score (mock provider for CI) | — |
| 11 | `gate_help` | Full docs on demand; `tool=recommended_stack` for workflow | 46% schema overhead |

Every compression-oriented tool response includes measured token fields where
applicable (`originalTokens`, `optimizedTokens`, `savingsPercent`). When
compression **inflates** output, `expanded: true` and savings are **not**
reported as positive (no fake “-56% savings”). `gate_init` /
`gate_session_stats` / `gate_dedup_context` use different payload shapes.

**Recommended workflow** (monorepos with nested `graphify-out/`):

1. `gate_init` — confirm graphify path and set `GATE_PROJECT_ROOT` if needed  
2. `gate_graph_query` with `queryType: graphify_map` (map before full `Read`)  
3. `gate_compress_file` with `depth: signature` (Python/TS) or `structure` (YAML/MD)  
4. `gate_session_stats` — measured session work plus cache activity (pass the same `projectRoot` in multi-repo setups)

Call `gate_help` with `tool: "recommended_stack"` for the full playbook.

### Multi-repo / one global MCP

One Cursor MCP server can serve many folders under a shared parent. Tool
argument `projectRoot` **narrows** that boundary; it cannot widen it.

| Setting | Guidance |
|---|---|
| `GATE_PROJECT_ROOT` | Set to the trusted parent (e.g. `/home/you/Documents`), not a single child repo |
| `GATE_CACHE_DB` | Put the SQLite file **inside** that parent (e.g. `$GATE_PROJECT_ROOT/.gate-mcp/cache.db`) |
| Per-call `projectRoot` | Pass the active repo root on `gate_compress_file`, `gate_graph_query`, `gate_init`, `gate_dedup_context`, and `gate_session_stats` |
| Relative paths | Resolve against per-call `projectRoot` when supplied; otherwise against **`GATE_PROJECT_ROOT` if set, else the MCP server startup cwd** — not necessarily the IDE’s open folder |
| Cache partition | Dedup rows always live under the trusted ceiling (one partition). `projectRoot` **filters** stats/clear to paths under that folder |

```js
// Active work is playground/web while GATE_PROJECT_ROOT is /Documents
gate_compress_file({
  filePath: "src/app.js",
  depth: "signature",
  projectRoot: "/Documents/playground/web",
});
gate_session_stats({ projectRoot: "/Documents/playground/web" });
```

**`gate_session_stats` scoping:** Response includes `projectRoot` (path filter) and
`cachePartition` (always the trusted ceiling). `totalEntries` / `totalHits` /
`totalTokensSaved` / `topEntries` are filtered by `projectRoot`. `files_considered`,
`files_compressed` (non-`full`, non-cache-hit compressions only), byte/token
counters, and `cache_hits` are **process-wide** for this MCP instance.
`estimated_tokens_after` counts the **serialized tool JSON**, not just the
compressed content field. All of these are `billingScope: "tool_payload_only"` —
not Cursor billed usage.

Omitting `projectRoot` on `gate_dedup_context` `clear` wipes the **entire**
partition under the trusted ceiling (all sibling repos). Pass a child
`projectRoot` to clear only that path scope.

**`gate_optimize_image`** does not accept `projectRoot`; image paths must already
lie under `GATE_PROJECT_ROOT` (prefer absolute paths).

If `gate_init` reports `cache.persistent: false` and `cache.path: "(memory)"`,
read `cache.fallbackReason` — `GATE_CACHE_DB` was attempted; SQLite failed to
open (often a broken `better-sqlite3` native install). Rebuild with approved
install scripts, then restart the MCP server.

### How to read savings metrics

Compression-oriented tools (`gate_compress_file`, `gate_graph_query`,
`gate_clean_response`, `gate_optimize_image`, proxy tools, etc.) include measured
`originalTokens` / `optimizedTokens` / `savingsPercent` where applicable.
`gate_init`, `gate_session_stats`, and `gate_dedup_context` do **not** always
expose those three fields.

`savingsPercent` compares **tool payloads** (compressed view vs raw file or
`GRAPH_REPORT.md`). It is **not** Cursor billed usage.

| Field | Meaning |
|---|---|
| `baseline` | `"file"` \| `"GRAPH_REPORT.md"` \| `"symbol_estimate"` |
| `billingScope` | `"tool_payload_only"` on compress/graph/session_stats |
| `expanded: true` | Output grew; `savingsPercent` is forced to `0` |

Ignore positive % as “Cursor tokens saved.” Use it only to compare Gate payload sizes.

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

Path-traversal protection: by default, tool calls are restricted to the trusted
boundary — **`GATE_PROJECT_ROOT` when set, otherwise the MCP server’s startup
`cwd()`**. Per-call `projectRoot` may only select that root or a subdirectory.

| Env var | Default | Purpose |
|---|---|---|
| `GATE_PROJECT_ROOT` | `process.cwd()` | Trusted path ceiling (must be an **existing directory**); tool `projectRoot` may only narrow this |
| `GATE_ALLOW_ANY_PATH` | `0` | Set to `1` to disable boundary (NOT recommended) |
| `GATE_MAX_FILES` | `5000` | Max files indexed by symbol graph (hard cap 50000) |
| `GATE_MAX_FILE_BYTES` | `33554432` | Maximum file size accepted by `gate_compress_file` |
| `GATE_CACHE_DB` | `<GATE_PROJECT_ROOT>/.gate-mcp/cache.db` | Persistent dedup DB under the trusted ceiling (not per-call `projectRoot`); must stay inside that ceiling |
| `GATE_GRAPHIFY_REPORT` | _(auto-discover)_ | Absolute path to `GRAPH_REPORT.md` if not under cwd |
| `GATE_ENABLE_PROXY` | `0` | Set to `1` only after reviewing proxy commands |

Sensitive paths (`~/.ssh`, `~/.aws/credentials`, `/etc/passwd`, etc) are blocked regardless of boundary.

## Benchmarks

### Historical real-codebase results

The React figures below were produced by the v0.3.2 benchmark and are not a
universal or current-session guarantee. Release gates use deterministic QA;
rerun the benchmark before publishing new marketing claims.

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
<summary><strong>Modeled per-turn example (not a measurement)</strong></summary>

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

### Codex plugin

Install the repository marketplace and plugin with one command:

```bash
codex plugin marketplace add Dukeabaddon/Gate-MCP && codex plugin add gatemcp@dukeabaddon-gate-mcp
```

Restart Codex and open a new thread. Plugin MCP tools are loaded when a session
starts, so the current thread will not gain `gate_init` after installation.
Verify the installation by asking Codex to call `gate_init`, then confirm
`gate_graph_query`, `gate_compress_file`, `gate_session_stats`, and `gate_help`
are visible.

The checked-in plugin pins the currently published npm server,
`@gatemcp/cli@0.5.5`. Source-only changes in this repository become available
through the marketplace after that package pin is updated to a published
release. Until then, test the source build with `node dist/main.js doctor`.
The plugin uses explicit `npm exec --package` resolution and a strict native
build allowlist. This keeps SQLite available on a fresh npm 12 install without
allowing unrelated dependency scripts.

### Installation diagnostics

After building this source checkout, run the end-to-end doctor:

```bash
npm run build
node dist/main.js doctor /absolute/path/to/your/repo --strict
```

The published `@gatemcp/cli@0.5.5` does not contain doctor yet. Do not use its
`npx` command for this check. Doctor checks the executable, Node dependencies,
repository permissions, a SQLite write/reopen probe, the MCP initialize handshake, and
`tools/list`. Diagnostics use `stderr`; `--json` writes a machine-readable
report to `stdout` because doctor mode is not an MCP transport.

Maintainers can run `npm run test:mcp` after `npm run build` for the Codex/MCP
acceptance smoke. It verifies initialization, tool discovery, large-file
compression, exact session metrics, clean JSON-RPC framing, and shutdown. The
same smoke runs automatically before npm publication.

`npm run test:plugin` separately tests the exact network-backed command pinned
in `.mcp.json`. It is intentionally outside `prepublishOnly` because it tests
the already-published package rather than the source being released.

### Measured session statistics

`gate_session_stats` keeps the existing persistent cache totals and adds
process-local measurements. `files_considered` counts every successful,
schema-valid `gate_compress_file` result. `files_compressed` counts successful
non-`full`, non-cache-hit work. `cache_hits` counts successful deduplicated
results. `input_bytes` counts every file considered, including cache hits.
`output_bytes` and `estimated_tokens_after` cover the complete serialized Gate
result, excluding the MCP/JSON-RPC envelope. `measurement_scope` records that
boundary explicitly. `session_elapsed_ms` is wall-clock time since startup.

### Configure your IDE

After the reviewed global installation command above, add `gatemcp` to your
IDE's MCP config. Click your IDE below for the exact snippet.

<details>
<summary><strong>Cursor</strong> — <code>.cursor/mcp.json</code> in your workspace</summary>

```json
{
  "mcpServers": {
    "gatemcp": {
      "command": "gatemcp",
      "args": [],
      "env": {
        "GATE_PROJECT_ROOT": "/absolute/path/to/Documents",
        "GATE_CACHE_DB": "/absolute/path/to/Documents/.gate-mcp/cache.db"
      }
    }
  }
}
```

For a single repo, point both env vars at that repo. For multi-repo agents, use the
parent folder as above, then pass per-call `projectRoot` to the active child repo.

In Cursor the server may appear as **`user-gatemcp`** (not `gatemcp`) — that is normal.

Restart Cursor. Open the MCP panel (Settings → Features → MCP Servers) to verify the server is connected. Run **`gate_init`** once per workspace. If `cache.persistent` is false, read `cache.fallbackReason` and rebuild `better-sqlite3`.
</details>

<details>
<summary><strong>Claude Code</strong> — <code>~/.claude/mcp.json</code></summary>

```json
{
  "mcpServers": {
    "gatemcp": {
      "command": "gatemcp",
      "args": []
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
      "command": "gatemcp",
      "args": []
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
      "command": "gatemcp",
      "args": [],
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
      "command": "gatemcp",
      "args": []
    }
  }
}
```

**Note:** VS Code uses `"servers"` (not `"mcpServers"`). Reload the window after saving.
</details>

<details>
<summary><strong>Other MCP-aware tools</strong> (Cline, Zed, Continue.dev, custom)</summary>

Any client that supports MCP over stdio works. After global installation, the
generic invocation is:

```bash
gatemcp
```

Pass it via your client's MCP config with command `gatemcp` and no arguments.
If your client uses a different config key such as `tools.mcpServers`, adapt
the wrapping object. Gate speaks MCP over stdio.
</details>

### Example: Compress a File

These outputs are illustrative. Actual values are calculated from each serialized
tool result and can be lower, zero, or negative.

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
  rawReadTokens: 15,200 (modeled baseline, not observed host traffic)
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

Exact test counts are printed by `npm run qa`.

## Tech Stack

- **Runtime:** Node.js 20–26 + TypeScript ESM
- **MCP SDK:** `@modelcontextprotocol/sdk` ^1.12.1
- **AST:** tree-sitter where the host ABI loads; deterministic regex/direct-JSON fallback otherwise
- **Image:** sharp ^0.33 (primary) + jimp 1.6 (fallback) + tesseract.js 5.1
- **Tokens:** gpt-tokenizer ^2.8.1 (real BPE counts, not estimates)
- **Cache:** better-sqlite3 ^12 (optional, WAL mode) with in-memory Map fallback
- **Validation:** Zod
- **Dependencies:** See `package.json` for the maintained runtime and optional parser set. No cloud service or hosted model is required.

## Comparison

| Feature | gatemcp | Graphify | Caveman | mcp-compressor |
|---|---|---|---|---|
| Layers compressed | **4+** | 1 (nav) | 1 (output) | 1 (schema) |
| Installation | `npm i -g` | `pip install` | System prompt | npm |
| Cloud required | No | No | No | No |
| ML models needed | No | No | No | No |
| Languages | Native plus fallback tiers listed above | 25+ | Any | Any |
| Codebase size | ~5.5K LOC | 252K LOC | ~100 lines | ~500 LOC |

Gate combines these opt-in input-side functions in one MCP server.

## Development

```bash
# Install (with optional parsers)
npm install

# Build
npm run build

# Run the unit suite
npm test

# AlgoTrading / nested-graphify regression (optional)
npm run validate:algo

# Run the stress suite
npm run stress

# Complete production gate
npm run qa

# LLM-in-the-loop validation CLI (mock provider, no API key)
node dist/scripts/validate-llm.js src/main.ts

# Start MCP server
npm start
```

## Release status

The v0.5.6 source is a release candidate. `npm run qa` is the required local
gate. Public npm deployment and the plugin pin are separate release actions;
do not call v0.5.6 deployed until both complete.

- [x] Published stable package (`@gatemcp/cli@0.5.5`)
- [ ] Publish `@gatemcp/cli@0.5.6`, then align the plugin pin
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
<summary><strong>v0.5.6 release candidate</strong> — Codex plugin, doctor, measurable session statistics</summary>

**QA follow-up (multi-repo).** `gate_compress_file`, `gate_dedup_context`, and
`gate_session_stats` accept optional `projectRoot` (parity with
`gate_graph_query` / `gate_init`). Args may only narrow `GATE_PROJECT_ROOT`,
never widen it. Dedup rows share one partition under the trusted ceiling;
`projectRoot` filters stats/clear by path (so omitting vs passing child root
no longer splits the same file across two caches). Persistent totals in
`gate_session_stats` honor that filter; process-local counters do not.
`gate_init` reports `cache.kind`, `cache.partition`, and `cache.fallbackReason`
when SQLite cannot open. Compress/graph/session results label
`billingScope="tool_payload_only"`. Proof: `npm test` + `test:mcp-inspector`
(official MCP Inspector CLI).

**Codex installation.** Adds a repository marketplace, validated Codex plugin,
and pinned MCP server command. The active session must be restarted after
installation.

**Diagnostics.** Adds `gatemcp doctor` with executable, dependency, project
root, permission, cache, MCP initialize, and tool-discovery checks. Failures
are structured and logs remain on `stderr`.

**Metrics.** `gate_session_stats` now reports files considered/compressed,
input/output bytes, estimated tokens before/after, cache hits, and elapsed time
with exact cache-hit aggregation semantics.

**Tests.** Adds raw JSON-RPC and isolated plugin-command acceptance tests,
including large JSON compression, framing, errors, and graceful shutdown.

**Production hardening.** Adds canonical realpath boundaries, symlink-escape
rejection, project-isolated storage, cache identity/schema migration, JSON
schema outlines, serialized-result metrics, strict SQLite probes, bounded file
inputs, secure-by-default proxy execution, dependency audit overrides, and CI
across supported Node and operating-system targets.

</details>

<details>
<summary><strong>v0.5.5</strong> — Honest metrics, <code>gate_init</code>, YAML structure mode</summary>

**Metrics.** `expanded: true` when compressed output is larger than raw; `savingsPercent` never fakes positive savings. Dedup stats clamp negative “tokens saved”. `graphify_map` sets `originalTokens` from full `GRAPH_REPORT.md`.

**Compression.** `gate_compress_file` depth `structure` for YAML/Markdown/JSON; auto-structure for config files; summary on YAML redirects to structure (fixes inflated YAML “savings”).

**New tools.** `gate_init` (health + graphify stale warning + cache path), `gate_session_stats` (cumulative dedup savings).

**Graphify.** `rebuild=true` on `gate_graph_query` runs `graphify update .` when the graphify CLI is on PATH. Stale report warning when report commit ≠ `git HEAD`.

**Tests.** Run `npm test`; use `npm run validate:algo` for nested `graphify-out` layouts such as AlgoTrading SMC.

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

**VS Code:** `vscode-extension/` — JSON snippets (`gatemcp-mcp`, `gatemcp-cursor-mcp`) plus a README task template for the installed `gatemcp` binary.

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
| **Memory fallback** | Without `better-sqlite3`, `gate_memory` uses bounded atomic JSON with a cooperative lock; use strict doctor when SQLite/WAL is required. |
| **Tier 2 grammars** | Vue / Svelte / YAML optional deps may not load on all platforms; regex fallback still applies. |
| **Proxy execution** | Disabled by default. Review the project config, then set `GATE_ENABLE_PROXY=1` explicitly. |

<details>
<summary><strong>v0.5.0</strong> — proxy mode and historical modeled schema-overhead estimates</summary>

This release was published as `@gatemcp/cli@0.5.0`. The unpinned install
command now resolves the latest published Gate version.

</details>

<details>
<summary><strong>v0.5.0 details</strong> — full notes</summary>

**New tools.** `gate_proxy_tools` and `gate_proxy_call`. Lets gatemcp front-end every other MCP server you have configured (GitHub, Postgres, Filesystem, Linear, etc.) so the LLM sees one compressed catalog instead of paying full schema cost for each server every turn.

**How it works.** Drop a `.gate-mcp/proxy-servers.json` in your project root (same shape as your IDE's MCP config). gatemcp lazily spawns each downstream server as a child stdio MCP client, lists their tools, compresses descriptions + JSON schemas, and exposes them via two thin proxy tools. Responses route back through the same TOON compressor that powers `gate_clean_response`.

**Safety.** Per-call timeout (default 30s, configurable via `GATE_PROXY_TIMEOUT_MS`) so a wedged downstream server cannot starve gatemcp. Wedged connections are dropped on timeout and the next call re-spawns cleanly. Cleanup is non-blocking so the LLM sees the timeout error immediately. Connections are pooled across calls (one spawn per server per session) and torn down on graceful shutdown.

**Test fixture.** Ships with a deterministic mock MCP server (built from source only, excluded from the published tarball) so the test suite covers spawn → list → describe → call → timeout → cleanup end-to-end. 8 new unit tests at 25 total.

The v0.5.0 release used a modeled 10-server / 50-tool roster to estimate schema-overhead reduction. This was not an end-to-end host measurement. Use `gate_proxy_tools` with `action: 'list'` once per session, then `action: 'describe'` only before invoking a tool whose full schema is required.

See [`.gate-mcp/proxy-servers.example.json`](./.gate-mcp/proxy-servers.example.json) for a starting config.
</details>

<details>
<summary><strong>v0.4.0</strong> — published to npm as <code>@gatemcp/cli</code> + persistent dedup cache (SQLite/WAL)</summary>

**npm publish.** This version established the `@gatemcp/cli` scoped package.
The unscoped name `gatemcp` was rejected by npm's similarity check against the
pre-existing `gate-mcp` package. The CLI binary remains `gatemcp`.

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
