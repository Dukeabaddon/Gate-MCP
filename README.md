<div align="center">

<p>
  <img src="assets/gatemcp-banner.png" alt="gatemcp" width="100%" />
</p>

### **Measure and reduce context without hiding fidelity failures.**

**Gate-MCP — local context compression gateway for AI coding assistants**

Gate sits between your agent and the expensive parts of an MCP turn: tool schemas,
file bodies, JSON tool results, and screenshots. It compresses what you ask it to,
caches unchanged work in SQLite, and labels every savings number with an honest
`billingScope`. Opt-in only — Gate does **not** intercept editor `Read` / `Bash`.

| Problem | With Gate-MCP |
|---------|---------------|
| Fat `tools/list` every turn | Default **catalog** mode: ~6 tools + `gate_invoke` |
| Full-file reads for navigation | AST **signatures** / bounded **structure** |
| Re-reading unchanged files | SQLite dedup cache (required `better-sqlite3`) |
| Huge JSON tool responses | TOON tables when the shape fits |
| Screenshots eating the window | OCR text or downscale via `gate_optimize_image` |

</div>

<p align="center">
  <a href="https://github.com/Dukeabaddon/Gate-MCP/stargazers"><img src="https://img.shields.io/github/stars/Dukeabaddon/Gate-MCP?style=social" alt="GitHub Stars"></a>&nbsp;&nbsp;
  <a href="https://github.com/Dukeabaddon/Gate-MCP/actions/workflows/ci.yml"><img src="https://github.com/Dukeabaddon/Gate-MCP/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/@gatemcp/cli"><img src="https://img.shields.io/npm/v/@gatemcp/cli?label=npm%20%40gatemcp%2Fcli&color=%23cb3837" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@gatemcp/cli"><img src="https://img.shields.io/npm/dt/@gatemcp/cli?label=downloads&color=%23cb3837" alt="npm downloads (total)"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License"></a>
  <img src="https://img.shields.io/badge/Telemetry-None-brightgreen?logo=shield&logoColor=white" alt="No telemetry">
  <img src="https://img.shields.io/badge/SQLite-Required-informational" alt="SQLite required">
</p>

<p align="center">
  <a href="https://gate-mcp-site.vercel.app/"><strong>Website</strong></a> ·
  <a href="#get-started-60-seconds">Install</a> ·
  <a href="#demo">Demo</a> ·
  <a href="#benchmarks">Benchmarks</a> ·
  <a href="#supported-ides--ai-tools">Agents</a> ·
  <a href="ARCHITECTURE.md">Architecture</a> ·
  <a href="#privacy--security">Security</a> ·
  <a href="#changelog">Changelog</a>
</p>

---

> **Token savings are a receipt — fidelity is the product.** Gate reports
> `originalTokens` / `optimizedTokens` / `savingsPercent` on compression tools,
> forces `expanded: true` (and 0% “savings”) when output grows, and scopes metrics
> as `billingScope: "tool_payload_only"` so nobody mistakes tool JSON size for
> Cursor billed usage.

<p align="center"><strong>See it in action:</strong></p>

<table>
  <tr>
    <td align="center" width="33%">
      <img src="assets/gatemcp-compress.gif" width="320" alt="gate_compress_file signature demo">
      <br/>
      <strong>Compress</strong>
      <br/>
      AST signatures with measured %
    </td>
    <td align="center" width="33%">
      <img src="assets/gatemcp-catalog.gif" width="320" alt="Gate navigate then compress demo">
      <br/>
      <strong>Navigate</strong>
      <br/>
      Graph dependents → signature compress
    </td>
    <td align="center" width="33%">
      <img src="assets/gatemcp-benchmark.gif" width="320" alt="gate_session_stats demo">
      <br/>
      <strong>Stats</strong>
      <br/>
      Measured session tokens + cache
    </td>
  </tr>
</table>

<p align="center"><sub>Recorded Cursor + Gate MCP demos · silent loop GIFs in <code>assets/</code>.</sub></p>

## Why developers use Gate

- **Schema budget first** — catalog mode attacks the tax every MCP turn pays before you read a single file
- **Measured, not vibed** — compression tools return real BPE counts; inflation is never sold as savings
- **Navigate then hydrate** — symbol graph + optional graphify bridge before full `Read`
- **Durable cache** — SQLite/WAL dedup across IDE restarts (fail-closed unless you opt into memory)
- **Local-only** — no cloud, no telemetry, path jail under `GATE_PROJECT_ROOT`

<p align="center">
  <strong>Saves you tokens?</strong> <a href="https://github.com/Dukeabaddon/Gate-MCP">Give it a star</a> — it helps others find Gate.
</p>

---

## What it does — four layers

Architecture detail: [`ARCHITECTURE.md`](ARCHITECTURE.md).

```
                        ┌──────────────────────────┐
                        │    YOUR AI ASSISTANT      │
                        │  (Cursor / Claude Code /  │
                        │   Windsurf / Antigravity) │
                        └─────────┬────────────────┘
                                  │
                     ┌────────────▼────────────────┐
                     │           gatemcp            │
                     │  L0  Catalog tool surface    │
                     │  L1  Graph navigation        │
                     │  L2  File compression        │
                     │  L3  Response cleaning       │
                     │  L4  SQLite persistence      │
                     └──────────────────────────────┘
```

| Layer | Job |
|-------|-----|
| **L0 Schema** | `GATE_TOOL_MODE=catalog` (default): `gate_help`, `gate_init`, compress/graph/stats, `gate_invoke`. Set `full` to list every tool. |
| **L1 Graph** | In-process tree-sitter symbol graph + optional `graphify-out` bridge (`graphify_map` / `search` / `hubs`). HTML export via `export_html` / `gatemcp graph-html`. |
| **L2 Compress** | `gate_compress_file` depths: `signature` / `structure` / `summary` / `full`. Image OCR/downscale. |
| **L3 Clean** | `gate_clean_response` TOON; optional MCP proxy (`GATE_ENABLE_PROXY=1`). |
| **L4 Persist** | Required `better-sqlite3` WAL DB for dedup + `gate_memory`. |

**Recommended workflow**

1. `gate_init` — health, graphify path, cache kind  
2. `gate_graph_query` (`graphify_map` or symbol search) — navigate before full reads  
3. `gate_compress_file` (`signature` or `structure`) — hydrate only what you need  
4. `gate_session_stats` — measured tool-payload work  

`gate_help` with `tool: "recommended_stack"` is the agent-facing playbook.

<a id="what-gate-compresses"></a>

### What Gate compresses — and what it does not

Gate only shrinks **results of Gate tool calls**. It is a tool your agent
chooses to call, not a filter on the whole conversation.

| Gate reduces | Gate does **not** touch |
|---|---|
| `tools/list` schema size (catalog mode) | Your prompts and chat history |
| File views returned by `gate_compress_file` | The editor's built-in `Read` / `Grep` / terminal output |
| Graph answers from `gate_graph_query` | Rules, system prompt, attached files |
| Re-reads of unchanged files (SQLite dedup) | Model output — generated code and replies |
| JSON passed to `gate_clean_response` | Other MCP servers (unless routed through the opt-in proxy) |
| Images passed to `gate_optimize_image` | Your provider bill — see `billingScope` below |

What this means in practice:

- If the agent never calls a Gate tool, savings are **zero**. Add a rule
  telling your agent to use `gate_compress_file` before full reads.
- An agent footer such as `Savings: n/a` means no Gate compression ran that
  turn. It does not mean Gate is broken. Run `gate_init` to confirm health.
- Gate cannot shrink code generation. Smaller input context leaves more room
  for output, but the output itself is the model's.

---

<a id="get-started-60-seconds"></a>

## Get started (60 seconds)

`better-sqlite3` is a **required** dependency. Install must allow its native
build (and the other reviewed native packages below).

```bash
npm install -g --strict-allow-scripts \
  --allow-scripts=better-sqlite3,sharp,tesseract.js,tree-sitter,tree-sitter-bash,tree-sitter-c,tree-sitter-c-sharp,tree-sitter-cli,tree-sitter-cpp,tree-sitter-css,tree-sitter-go,tree-sitter-html,tree-sitter-java,tree-sitter-javascript,tree-sitter-json,tree-sitter-kotlin,tree-sitter-php,tree-sitter-python,tree-sitter-ruby,tree-sitter-rust,tree-sitter-svelte,tree-sitter-swift,tree-sitter-typescript,tree-sitter-vue,tree-sitter-yaml \
  @gatemcp/cli
```

Or without a global install:

```bash
npm exec --yes --strict-allow-scripts \
  --allow-scripts=better-sqlite3,sharp,tesseract.js,tree-sitter,tree-sitter-bash,tree-sitter-c,tree-sitter-c-sharp,tree-sitter-cli,tree-sitter-cpp,tree-sitter-css,tree-sitter-go,tree-sitter-html,tree-sitter-java,tree-sitter-javascript,tree-sitter-json,tree-sitter-kotlin,tree-sitter-php,tree-sitter-python,tree-sitter-ruby,tree-sitter-rust,tree-sitter-svelte,tree-sitter-swift,tree-sitter-typescript,tree-sitter-vue,tree-sitter-yaml \
  --package=@gatemcp/cli -- gatemcp
```

Package: `@gatemcp/cli` · binary: `gatemcp` · current: **0.5.8**.

Then wire your IDE (Cursor snippet below). Run **`gate_init`** once per workspace.
Doctor: `npx --package=@gatemcp/cli@0.5.8 gatemcp doctor /abs/path/to/repo --strict`.

<details>
<summary><strong>Install from source</strong></summary>

```bash
git clone https://github.com/Dukeabaddon/Gate-MCP.git
cd Gate-MCP
npm install --strict-allow-scripts \
  --allow-scripts=better-sqlite3,sharp,tesseract.js,tree-sitter,tree-sitter-bash,tree-sitter-c,tree-sitter-c-sharp,tree-sitter-cli,tree-sitter-cpp,tree-sitter-css,tree-sitter-go,tree-sitter-html,tree-sitter-java,tree-sitter-javascript,tree-sitter-json,tree-sitter-kotlin,tree-sitter-php,tree-sitter-python,tree-sitter-ruby,tree-sitter-rust,tree-sitter-svelte,tree-sitter-swift,tree-sitter-typescript,tree-sitter-vue,tree-sitter-yaml
npm run build
npm link
```

</details>

<details>
<summary><strong>Cursor</strong> — <code>.cursor/mcp.json</code></summary>

```json
{
  "mcpServers": {
    "gatemcp": {
      "command": "gatemcp",
      "args": [],
      "env": {
        "GATE_PROJECT_ROOT": "/absolute/path/to/Documents",
        "GATE_CACHE_DB": "/absolute/path/to/Documents/.gate-mcp/cache.db",
        "GATE_TOOL_MODE": "catalog"
      }
    }
  }
}
```

Cursor may show the server as **`user-gatemcp`** — that is normal. Multi-repo:
set `GATE_PROJECT_ROOT` to the trusted parent, pass per-call `projectRoot` to
narrow (never widen).

</details>

<a id="pin-node-for-sqlite"></a>

<details>
<summary><strong>Pin Node in <code>mcp.json</code></strong> — fixes SQLite <code>NODE_MODULE_VERSION</code> errors</summary>

`better-sqlite3` is a native module. It is compiled for the Node version that
ran `npm install`. Your IDE may launch MCP servers with a **different** Node
(nvm, Homebrew, Volta, or a GUI app `PATH` without your shell profile).

Symptoms:

- Server fails to start, or `gate_init` / `gate_session_stats` shows `persistentCache: false`
- Log line like `was compiled against a different Node.js version using NODE_MODULE_VERSION 127. This version of Node.js requires NODE_MODULE_VERSION 137`

Fix: point the IDE at the **same** Node binary that installed Gate. In the
terminal where you installed it:

```bash
which node                                   # e.g. /Users/you/.nvm/versions/node/v22.21.1/bin/node
echo "$(npm root -g)/@gatemcp/cli/dist/main.js"
```

Then use both absolute paths:

```json
{
  "mcpServers": {
    "gatemcp": {
      "command": "/Users/you/.nvm/versions/node/v22.21.1/bin/node",
      "args": ["/Users/you/.nvm/versions/node/v22.21.1/lib/node_modules/@gatemcp/cli/dist/main.js"],
      "env": {
        "GATE_PROJECT_ROOT": "/absolute/path/to/your/repo"
      }
    }
  }
}
```

Verify with the same Node:
`/path/to/node /path/to/dist/main.js doctor /absolute/path/to/your/repo --strict` —
`cache_access` must say `SQLite write/reopen probe passed`.

If you switch Node versions later, reinstall Gate under the new version (or
keep the pin). Avoid `GATE_ALLOW_MEMORY_CACHE=1` as a fix — it hides the
problem and turns off persistent dedup.

</details>

<details>
<summary><strong>Claude Code / Windsurf / Antigravity / VS Code / Codex</strong></summary>

**Claude Code** — `~/.claude/mcp.json`: `{ "mcpServers": { "gatemcp": { "command": "gatemcp", "args": [] } } }`

**Windsurf** — `~/.codeium/windsurf/mcp_config.json`: same `mcpServers` shape.

**Antigravity** — `.antigravity/mcp.json` with `MCP_MODE=stdio` and `DISABLE_CONSOLE_OUTPUT=true`.

**VS Code Copilot** — `.vscode/mcp.json` uses `"servers"` (not `"mcpServers"`).

**Codex plugin**

```bash
codex plugin marketplace add Dukeabaddon/Gate-MCP && codex plugin add gatemcp@dukeabaddon-gate-mcp
```

Restart the thread after install. Plugin pins `@gatemcp/cli@0.5.8`.

</details>

Emergency only: `GATE_ALLOW_MEMORY_CACHE=1` skips the startup SQLite module check
(tests / broken hosts). Prefer fixing the native install.

---

## Tools

| Tool | What it does |
|------|----------------|
| `gate_init` | Health: graphify path, SQLite, toolMode, MCP slug hint |
| `gate_compress_file` | AST signatures / structure / summary / full |
| `gate_graph_query` | Symbol graph + graphify map/search/hubs + HTML export |
| `gate_session_stats` | Measured file/byte/token work + cache activity |
| `gate_help` | Full docs; `tool=recommended_stack` |
| `gate_invoke` | Catalog escape hatch: call any Gate tool by name |
| `gate_dedup_context` | Reference-only unchanged check / cache ops |
| `gate_memory` | Cross-session KV in SQLite |
| `gate_clean_response` | JSON → TOON |
| `gate_optimize_image` | OCR or downscale |
| `gate_proxy_tools` / `gate_proxy_call` | Opt-in downstream MCP compression |
| `gate_validate_compression` | LLM-in-the-loop quality score (mock for CI) |

Compression-oriented tools include `originalTokens` / `optimizedTokens` /
`savingsPercent` where applicable. When output **grows**, `expanded: true` and
savings stay `0`.

<details>
<summary><strong>How to read savings metrics</strong></summary>

| Field | Meaning |
|---|---|
| `baseline` | `"file"` \| `"GRAPH_REPORT.md"` \| `"symbol_estimate"` |
| `billingScope` | `"tool_payload_only"` — **not** Cursor billed tokens |
| `expanded: true` | Output grew; `savingsPercent` forced to `0` |

</details>

<a id="reading-gate-session-stats"></a>

### Reading `gate_session_stats`

The result has two groups of numbers with **different scopes**. Do not add
them together.

**Persistent cache** — stored in SQLite, survives IDE restarts, filtered by `projectRoot`:

| Field | Meaning |
|---|---|
| `persistentCache` | `true` = SQLite. `false` = in-memory fallback; run `gatemcp doctor --strict` (often a [Node pin](#pin-node-for-sqlite) issue) |
| `cachePartition` | Canonical `GATE_PROJECT_ROOT` the DB belongs to (macOS shows `/private/var` for `/var`) |
| `projectRoot` | Path filter applied to the totals below |
| `totalEntries` | Files cached under that path |
| `totalHits` | Times an unchanged file was served from cache |
| `totalTokensSaved` | Cumulative raw-file tokens minus cached-view tokens on those hits |
| `topEntries` | Top 10 files by activity |

**This MCP process** — reset when the server restarts, counts every repo the process served:

| Field | Meaning |
|---|---|
| `files_considered` / `files_compressed` | Files Gate read / returned a smaller view for |
| `input_bytes` / `output_bytes` | Raw file bytes in vs tool-result bytes out |
| `estimated_tokens_before` / `estimated_tokens_after` | Same, as BPE token estimates |
| `cache_hits` | Dedup hits in this process |
| `elapsed_ms` / `session_elapsed_ms` | Gate processing time / server uptime |

Labels on every result:

- `measurement_scope: "serialized_tool_result_excluding_mcp_envelope"` — what was measured.
- `billingScope: "tool_payload_only"` — **not** your Cursor / provider bill. Your bill also includes prompts, history, rules, other tools, and model output.

Example from one real session: `estimated_tokens_before: 6622`,
`estimated_tokens_after: 666` → Gate tool results were ~90% smaller than the
raw files. That is the honest claim; it is not "90% off your bill".

<details>
<summary><strong>Multi-repo / one global MCP</strong></summary>

| Setting | Guidance |
|---|---|
| `GATE_PROJECT_ROOT` | Trusted parent directory |
| `GATE_CACHE_DB` | SQLite file **inside** that parent |
| Per-call `projectRoot` | Active child repo; narrow-only |
| Omitting `projectRoot` on dedup `clear` | Wipes the **entire** partition |

</details>

---

## Supported IDEs & AI tools

Gate is a standard **MCP server** (stdio). There is no shell-hook / Hybrid mode —
savings only land when the agent calls Gate tools (or you teach it via rules /
`AGENTS.md`).

| Mode | How it works | Best for |
|------|----------------|----------|
| **MCP** | Agent calls `gate_*` tools | Any MCP client |
| **Catalog** | Small `tools/list` + `gate_invoke` | Default (recommended) |
| **Full** | Every tool listed | Debugging only |

### Agent compatibility matrix

| Agent | MCP | Catalog | Setup |
|-------|:---:|:---:|------|
| Cursor | ● | ● | `.cursor/mcp.json` → `gatemcp` |
| Claude Code | ● | ● | `~/.claude/mcp.json` |
| Codex | ● | ● | `codex plugin add gatemcp@…` |
| Windsurf | ● | ● | Windsurf MCP config |
| Antigravity | ● | ● | `.antigravity/mcp.json` |
| VS Code Copilot | ● | ● | `.vscode/mcp.json` (`servers`) |
| Cline / Roo / Continue / Zed | ● | ● | Generic stdio MCP |
| JetBrains / Neovim / Emacs | ● | ● | MCP-capable plugin + `gatemcp` |

> Any MCP-compatible client works. Hybrid shell interception is **intentionally out of scope** (see Architecture).

### When to use (and when not to)

**Great fit if you…**
- live in MCP-heavy agents (Cursor, Claude Code, Codex) and pay schema tax
- work in medium/large repos and can navigate via graph → signature
- want local, measurable compression without installing a full context OS

**Skip it (or pair carefully) if you…**
- need transparent shell/`git` compression on every agent command → that is LeanCTX Hybrid territory
- need an LLM request proxy that shrinks full chat history on the wire
- never teach the agent to call Gate (opt-in = zero savings)

---

<a id="demo"></a>

## Demo

```bash
# After MCP is connected
# 1) gate_init
# 2) gate_compress_file { filePath: "src/main.ts", depth: "signature" }
# 3) gate_session_stats

# Regenerate README GIFs
python3 scripts/generate-readme-gifs.py
```

Illustrative compress call:

```
gate_compress_file({ filePath: "src/main.ts", depth: "signature" })
→ originalTokens: 2,664 · optimizedTokens: 191 · savingsPercent: 93%
```

---

<a id="benchmarks"></a>

## Benchmarks

React figures below are from the **v0.3.2** real-repo harness. They are not a
universal or current-session guarantee. Rerun before publishing new marketing claims.

| Test | Target | Result |
|---|---|---|
| **React monorepo** | `facebook/react` `packages/` — 2,080 files, 3.93M tokens | **89% → 446k tokens** |
| **Symbol-recall fidelity** | 1,010 React files, 7,047 exports | **99.1%** (6,987/7,047) |
| **Per-file perfect recall** | 1,010 React files | **99.3%** files at 100% recall |
| **TOON fidelity** | Round-trip fields/values | **100%** (17/17 · 15/15) |
| **Scale** | VS Code source (6,115 TS files) | 3.2s build, 8ms queries |

```bash
git clone --depth 1 https://github.com/facebook/react ~/demo/react
node dist/scripts/benchmark-real-repo.js ~/demo/react/packages --out report.md
node dist/scripts/fidelity-test.js ~/demo/react/packages
```

<details>
<summary><strong>Modeled per-turn example (not a measurement)</strong></summary>

```
Typical AI coding session (before):
  Tool schemas:     30,000 tokens
  File reads (5):   10,000 tokens
  JSON responses:    5,000 tokens
  Total:            45,000 tokens

With gatemcp (agent actually calls Gate):
  Tool schemas:      3,000 tokens  (catalog + gate_help)
  File reads (5):      600 tokens  (AST signatures)
  JSON responses:    1,500 tokens  (TOON)
  Total:             5,100 tokens
```

</details>

---

## By the numbers

- **`@gatemcp/cli@0.5.8`** on npm — binary `gatemcp`
- **Catalog-first** tool surface (schema anti-bloat)
- **12** tools (6 hot-path in catalog + long tail via `gate_invoke`)
- **20+** languages via tree-sitter / regex fallback
- **MIT** · local-only · no telemetry
- React bench: **89%** payload reduction @ **99.1%** symbol recall

---

## Language support

| Tier 1 — Core native | Tier 2 — Optional native |
|---|---|
| JS / TS / TSX, Python, Java, C#, C/C++, Go, Rust, HTML, CSS, JSON | PHP, Ruby, Kotlin, Bash, Swift |

Regex fallback today: SQL, Scala, Markdown, Vue, Svelte, YAML (where native
bindings do not load cleanly). See `src/lib/astParser.ts`.

---

## Docs

- Architecture (SSOT): [`ARCHITECTURE.md`](ARCHITECTURE.md)
- Agent playbook: `gate_help` → `recommended_stack`
- Proxy example: [`.gate-mcp/proxy-servers.example.json`](./.gate-mcp/proxy-servers.example.json)
- Website: https://gate-mcp-site.vercel.app/

---

## Privacy & security

- **No telemetry**
- **Local process only** — code never leaves your machine unless *you* call a remote MCP through the opt-in proxy
- **Path jail** — tools restricted to `GATE_PROJECT_ROOT` (or startup cwd); per-call `projectRoot` may only narrow
- **Sensitive paths blocked** — `~/.ssh`, `~/.aws/credentials`, `/etc/passwd`, etc.
- **Proxy off by default** — `GATE_ENABLE_PROXY=1` required after review
- **SQLite required** — no silent memory fallback unless `GATE_ALLOW_MEMORY_CACHE=1`

| Env var | Default | Purpose |
|---|---|---|
| `GATE_PROJECT_ROOT` | `process.cwd()` | Trusted path ceiling |
| `GATE_ALLOW_ANY_PATH` | `0` | Disable boundary (not recommended) |
| `GATE_MAX_FILES` | `5000` | Symbol graph file cap (hard 50000) |
| `GATE_MAX_FILE_BYTES` | `33554432` | Max compress input |
| `GATE_CACHE_DB` | `<root>/.gate-mcp/cache.db` | Dedup + memory DB |
| `GATE_TOOL_MODE` | `catalog` | `catalog` \| `full` |
| `GATE_ENABLE_PROXY` | `0` | Downstream MCP proxy |

---

## Uninstall

1. Remove the `gatemcp` / `user-gatemcp` entry from your IDE MCP config  
2. Optional: delete the cache DB (`GATE_CACHE_DB` or `<project>/.gate-mcp/`)  
3. Remove the package:

```bash
npm uninstall -g @gatemcp/cli
# or stop using npm exec --package=@gatemcp/cli
```

Codex: remove the plugin from the Codex UI / plugin list. Source installs: `npm unlink -g` from the clone if you used `npm link`.

---

## Known limitations

| Area | Behavior |
|------|----------|
| **Opt-in only** | Zero savings if the agent never calls Gate — see [what Gate compresses](#what-gate-compresses) |
| **Code generation** | Model output is never compressed; Gate only shrinks tool results |
| **Native SQLite** | IDE must run the same Node that installed Gate — see [Pin Node](#pin-node-for-sqlite) |
| **gate graph vs graphify** | Different graphs; use `graphify_*` for communities |
| **Graph savings %** | Symbol queries use a modeled baseline; `graphify_map` baselines the report file |
| **Cursor MCP name** | May appear as `user-gatemcp` |
| **Proxy** | Disabled until `GATE_ENABLE_PROXY=1` |

---

## Development

```bash
npm install   # with allow-scripts as above
npm run build
npm test
npm run qa
npm start     # MCP stdio
```

Node **20** and **22–26** (Node 21 unsupported by required better-sqlite3).

---

## Star History

<a href="https://star-history.com/#Dukeabaddon/Gate-MCP&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Dukeabaddon/Gate-MCP&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Dukeabaddon/Gate-MCP&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Dukeabaddon/Gate-MCP&type=Date" />
  </picture>
</a>

---

## Changelog

<details open>
<summary><strong>v0.5.8</strong> — dependency security fixes, end-user docs</summary>

**Security.** `sharp` 0.35.3 → 0.35.5 (libheif / librsvg advisories). Lockfile
refresh clears transitive advisories in `proxy-addr`, `ip-address`, `fast-uri`,
`hono`, and `qs`. `npm audit --omit=dev` reports 0.

**Docs.** [What Gate compresses](#what-gate-compresses),
[reading `gate_session_stats`](#reading-gate-session-stats), and
[pinning Node for SQLite](#pin-node-for-sqlite).

**QA.** macOS `/var` vs `/private/var` canonical-path fixes in test scripts.
No tool behavior changes.

</details>

<details>
<summary><strong>v0.5.7</strong> — catalog mode, required SQLite, symbol HTML</summary>

**Schema budget.** Default `GATE_TOOL_MODE=catalog` lists six core tools plus
`gate_invoke`. Shared Zod schemas validate direct calls and `gate_invoke` args.

**SQLite policy.** Fail-closed unless `GATE_ALLOW_MEMORY_CACHE=1`. Doctor reports
the escape hatch and does not inherit it into its MCP child probe.

**Symbol graph viz.** `queryType=export_html` / `gatemcp graph-html`.

</details>

<details>
<summary><strong>v0.5.6</strong> — Codex plugin, doctor, measurable session statistics</summary>

`projectRoot` narrow-only on compress/dedup/session_stats; unified cache
partition; `billingScope="tool_payload_only"`; `gatemcp doctor`; Codex marketplace plugin.

</details>

<details>
<summary><strong>Earlier</strong> — v0.5.5 → v0.3.0</summary>

**v0.5.5** — Honest metrics (`expanded`), `gate_init`, YAML structure mode, graphify stale warning.

**v0.5.3** — Graphify bridge (`graphify_hubs` / `search` / `map`).

**v0.5.2** — SQLite-backed `gate_memory`.

**v0.5.1** — Tier-2 optional grammars + VS Code snippet pack + `gate_validate_compression`.

**v0.5.0** — MCP proxy mode (`gate_proxy_tools` / `gate_proxy_call`).

**v0.4.0** — Published as `@gatemcp/cli`; SQLite/WAL dedup.

**v0.3.2** — React monorepo fidelity fixes; **89%** reduction @ **99.1%** recall.

**v0.3.0** — Rename to `gatemcp` (npm collision with Gate.io).

Full historical detail remains in git history for those tags.

</details>

---

## Contributing

Issues and PRs: https://github.com/Dukeabaddon/Gate-MCP/issues  
Run `npm run qa` before opening a PR.

## License

MIT — see [LICENSE](LICENSE).

---

<p align="center">
  <a href="https://gate-mcp-site.vercel.app/">Website</a> ·
  <a href="https://github.com/Dukeabaddon/Gate-MCP">GitHub</a> ·
  <a href="https://github.com/Dukeabaddon/Gate-MCP/issues">Issues</a>
</p>

<p align="center">
  <sub>Built for developers who are tired of hitting rate limits — and of fake savings %.</sub>
</p>
