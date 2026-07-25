# Gate-MCP — Repository Structure

Directory map for the Gate-MCP package (`@gatemcp/cli`). Evidence from
`package.json`, `tsconfig.json`, `src/main.ts`, and on-disk layout under
`Gate-MCP/`. Companion to `.planning/codebase/ARCHITECTURE.md` (layers L0–L4).

## Top-level layout

```
Gate-MCP/
├── ARCHITECTURE.md          # Product SoT: layers, catalog, graph split, SQLite
├── README.md                # Install, tools, env, multi-repo, comparisons
├── package.json             # @gatemcp/cli; bin → dist/main.js; build = tsc
├── tsconfig.json            # ESM TypeScript → dist/
├── src/                     # Source of truth (tools, lib, tests, doctor)
├── dist/                    # Compiled JS + .d.ts (published + runtime)
├── scripts/                 # Node QA / release / MCP acceptance (.mjs)
├── plugins/                 # Codex plugin packaging (gatemcp)
├── vscode-extension/        # Lightweight VS Code snippets companion
├── test-fixtures/           # Fixtures for unit / QA scripts
├── graphify-out/            # Local graphify artifacts (runtime input, not src)
├── .gate-mcp/               # Runtime cache / symbol HTML / proxy config
└── .planning/codebase/      # This GSD map
```

**Publish surface** (`package.json` `files`): `dist/**/*.js`, `dist/**/*.d.ts`
(with test/regression exclusions), `README.md`, `LICENSE`, `ARCHITECTURE.md`.
**Bin:** `gatemcp` → `dist/main.js`. **Engines:** Node `>=20 <27`.

---

## `src/` — application source

| Path | Role |
|------|------|
| `src/main.ts` | MCP stdio server; tool registration; `doctor` / `graph-html` CLIs; graceful shutdown |
| `src/doctor.ts` | Health report (SQLite, path, graphify); `--strict` / `--json` |
| `src/version.ts` | `GATEMCP_VERSION` |
| `src/types.ts` | Shared language / compression types |
| `src/test.ts` | Unit / integration suite (`npm run test:unit` → `dist/test.js`) |
| `src/security-regression.ts` | Path / boundary regressions |
| `src/storage-regression.ts` | Cache / memory persistence regressions |
| `src/stress-test.ts` | Load / stress (`npm run stress`) |
| `src/tools/` | One MCP tool handler module per Gate tool (+ invoke) |
| `src/lib/` | Shared engines: AST, graphs, cache, path, proxy, metrics |
| `src/scripts/` | TS utilities compiled into `dist/scripts/` (validation, mocks) |

---

## `src/tools/` — MCP tool handlers

Handlers are wired in `main.ts` via `registerGateTool` and also dispatched by
`invoke.ts` for catalog long-tail.

| File | Tool name(s) | Layer / job |
|------|--------------|-------------|
| `help.ts` | `gate_help` | L0 — docs registry; `recommended_stack` playbook |
| `invoke.ts` | `gate_invoke` | L0 — catalog dispatcher (`HANDLERS` → all tools) |
| `gateInit.ts` | `gate_init` | Health: toolMode, graphify path, `cache.partition` |
| `graphQuery.ts` | `gate_graph_query` | L1a/L1b — symbol + graphify queries |
| `compressFile.ts` | `gate_compress_file` | L2 — AST/structure/summary/full |
| `optimizeImage.ts` | `gate_optimize_image` | L2 — OCR / downscale |
| `dedupContext.ts` | `gate_dedup_context` | L2/L4 — check/store/stats/clear (partition-aware) |
| `cleanResponse.ts` | `gate_clean_response` | L3 — toon / compact / whitelist |
| `proxyTools.ts` | `gate_proxy_tools`, `gate_proxy_call` | L3 — downstream MCP catalog + compressed call |
| `memory.ts` | `gate_memory` | L4 — cross-session KV |
| `sessionStats.ts` | `gate_session_stats` | Metrics — measured file/byte/token + dedup |
| `validateCompression.ts` | `gate_validate_compression` | Optional LLM-in-loop quality score |

Catalog core listed in `tools/list` by default: `help`, `init`, `compress_file`,
`graph_query`, `session_stats`, `invoke` (`lib/toolMode.ts`).

---

## `src/lib/` — shared libraries

| File | Responsibility |
|------|----------------|
| `toolMode.ts` | `GATE_TOOL_MODE`; `CATALOG_CORE_TOOLS` / `ALL_GATE_TOOLS` |
| `pathGuard.ts` | Trusted ceiling; `safeResolve*`; sensitive-path deny |
| `projectRoot.ts` | Code root + nested `graphify-out` discovery |
| `symbolGraph.ts` | In-process tree-sitter symbol/import graph |
| `symbolGraphViz.ts` | HTML export of Gate symbol graph |
| `astParser.ts` | tree-sitter (+ regex fallback) signatures / structure |
| `graphifyBridge.ts` | Parse/query `GRAPH_REPORT.md` |
| `graphifyRunner.ts` | Optional `graphify update` when CLI present |
| `graphifyFreshness.ts` | Stale report vs `git HEAD` warning |
| `cacheDb.ts` | better-sqlite3 WAL dedup cache (+ memory fallback) |
| `cacheScope.ts` | Partition (= ceiling) vs path-root filter for stats/clear |
| `sqliteRequired.ts` | Fail-fast unless `GATE_ALLOW_MEMORY_CACHE=1` |
| `memoryDb.ts` | `gate_memory` SQLite / `memory.json` backend |
| `imageProcessor.ts` | sharp/jimp + tesseract OCR |
| `tokenCounter.ts` | gpt-tokenizer BPE counts |
| `proxyClient.ts` | Downstream MCP connections; `proxy-servers.json` under `.gate-mcp` |
| `sessionMetrics.ts` | In-process measured work accounting |
| `llmProvider.ts` | mock / ollama / openai for validate tool |
| `validation.ts` | Shared input validation helpers |
| `logger.ts` | stderr-only structured logging |

---

## `scripts/` — package QA (repo root)

Plain Node `.mjs` scripts (not compiled). Wired from `package.json`:

| Script | Purpose |
|--------|---------|
| `check-release-consistency.mjs` | Version / release consistency |
| `production-regression.mjs` | Production-oriented regression |
| `qa-adversarial-audit.mjs` | Adversarial / abuse-path QA |
| `qa-multi-repo-proof.mjs` | Multi-repo / partition / path proofs |
| `test-mcp-acceptance.mjs` | MCP acceptance against built server |
| `test-mcp-inspector.mjs` | Inspector-oriented MCP checks |
| `test-packed-package.mjs` | Packed tarball smoke |
| `test-plugin-command.mjs` | Codex plugin packaging checks |

`npm test` runs `dist/test.js` plus multi-repo + adversarial QA scripts.
Full gate: `npm run qa` (build, tests, stress, security, storage, MCP, doctor,
release, package, audit).

### `src/scripts/` (compiled)

TypeScript helpers emitted to `dist/scripts/`: e.g.
`algotrading-validation.ts`, `verify-algo-graphify.ts`,
`p0-graphify-diagnostic.ts`, `mock-mcp-server.ts`, `fidelity-test.ts`,
`validate-llm.ts`, `benchmark-real-repo.ts`. Some are excluded from the npm
package `files` list (mock / fidelity / cursor-llm).

---

## `plugins/` — Codex plugin

```
plugins/gatemcp/
├── .codex-plugin/plugin.json   # Plugin metadata, skills path, UI copy
├── .mcp.json                   # mcpServers.gatemcp → npm exec @gatemcp/cli
└── skills/gatemcp-workflow/    # SKILL.md + agents/openai.yaml
```

Plugin pins package version and allow-scripts for native deps (better-sqlite3,
sharp, tesseract, tree-sitter grammars). Does **not** contain Gate server
logic — it launches the published CLI.

---

## `dist/` — build output

Produced by `npm run build` (`tsc`). Mirrors `src/`:

```
dist/
├── main.js (+ .d.ts)     # Runtime entry / bin
├── doctor.js
├── version.js, types.js
├── tools/*.js            # Compiled handlers
├── lib/*.js              # Compiled libraries
├── scripts/*.js          # Compiled src/scripts
└── test.js, *-regression.js, stress-test.js   # Local QA (mostly not published)
```

`npm start` → `node dist/main.js`. `clean` removes `dist/`.

---

## Adjacent (not core runtime)

| Path | Notes |
|------|-------|
| `vscode-extension/` | Snippets + README; separate from MCP server |
| `test-fixtures/` | Inputs for tests / QA |
| `graphify-out/` | External graphify output consumed by L1b |
| `.gate-mcp/` | Per-workspace cache DB, memory, proxy-servers.json, symbol-graph.html |
| `eng.traineddata` | Tesseract language data (OCR) |
| `.agents/` | Agent skill copies for this repo (workflow, not runtime) |

---

## Quick dependency → folder map

| Concern | Look first |
|---------|------------|
| Tool schema / registration | `src/main.ts`, `src/lib/toolMode.ts` |
| Catalog long-tail | `src/tools/invoke.ts` |
| Symbol vs graphify | `src/lib/symbolGraph.ts`, `src/lib/graphifyBridge.ts`, `src/tools/graphQuery.ts` |
| Path ceiling | `src/lib/pathGuard.ts` |
| Cache partition | `src/lib/cacheScope.ts`, `src/lib/cacheDb.ts` |
| Architecture policy | Repo-root `ARCHITECTURE.md` |
