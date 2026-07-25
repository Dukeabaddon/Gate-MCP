# Gate-MCP — Architecture Map

Evidence-backed map of the local MCP compression gateway. Primary sources:
repo-root `ARCHITECTURE.md`, `src/main.ts`, and the cited `src/lib/*` /
`src/tools/*` modules. Keep this thinner than the code; update when layers or
catalog policy change.

## Product boundary

Gate is a **local MCP compression gateway**. Agents call Gate tools; Gate does
**not** intercept editor `Read` / `Bash` automatically
(`ARCHITECTURE.md` product boundary).

| In scope | Out of scope |
|----------|--------------|
| Schema surface control (`GATE_TOOL_MODE`) | Rewriting assistant chat style |
| Code navigation (symbol graph + graphify bridge) | Owning a full corpus KG product (graphifyy) |
| File/AST compression, JSON/TOON clean | Code Mode sandbox runtime |
| Durable dedup + KV (SQLite), optional MCP proxy | LLMLingua-style token deletion on source |
| Image OCR/downscale, measured tool-payload metrics | |

## Runtime entry

`src/main.ts` is the Node ESM entry (`#!/usr/bin/env node`):

1. Resolves `toolMode` via `resolveToolMode()` (`src/lib/toolMode.ts`).
2. Builds an `McpServer` (`name: "gatemcp"`) and registers tools through
   `registerGateTool` → `shouldRegisterTool(name, toolMode)`.
3. Alternate CLIs on `argv[2]`: `doctor` (`src/doctor.ts`), `graph-html`
   (builds symbol graph + writes `.gate-mcp/symbol-graph.html`).
4. Before stdio connect: `assertSqliteModuleOrExit()`
   (`src/lib/sqliteRequired.ts`).
5. Shutdown: OCR terminate, `closeCacheDb`, `closeAllMemoryDbs`,
   `closeAllProxies`.

Stdout is JSON-RPC only; logging goes to stderr (`logger`).

## Recommended call pipeline

From root `ARCHITECTURE.md` / `gate_help tool=recommended_stack`:

```
1. gate_init              # SQLite, graphify path, toolMode
2. gate_graph_query       # navigate (symbol and/or graphify)
3. gate_compress_file     # hydrate only needed files
4. gate_clean_response / gate_proxy_call   # shrink structured JSON
5. gate_session_stats     # measured tool-payload accounting
```

## Layer model (L0–L4)

| Layer | Name | Mechanism | Primary code |
|-------|------|-----------|--------------|
| **L0** | Tool surface | Catalog vs full registration; docs + invoke dispatch | `toolMode.ts`, `main.ts` `registerGateTool`, `tools/help.ts`, `tools/invoke.ts` |
| **L1a** | Symbol graph | In-process tree-sitter import/call graph | `lib/symbolGraph.ts`, `lib/astParser.ts`, `tools/graphQuery.ts` |
| **L1b** | Graphify bridge | Reads `graphify-out/` (communities / god nodes); does **not** replace L1a | `lib/graphifyBridge.ts`, `lib/projectRoot.ts` (`findGraphifyReport`), `lib/graphifyRunner.ts`, `lib/graphifyFreshness.ts` |
| **L2** | File / image compress | AST signature / structure / summary / full; OCR + downscale; dedup store | `tools/compressFile.ts`, `tools/optimizeImage.ts`, `tools/dedupContext.ts`, `lib/astParser.ts`, `lib/imageProcessor.ts` |
| **L3** | Response clean | TOON / compact / whitelist; proxy call auto-compress | `tools/cleanResponse.ts`, `tools/proxyTools.ts` + `lib/proxyClient.ts` |
| **L4** | Persistence | Required `better-sqlite3` WAL DB; Map / JSON only on open failure or `GATE_ALLOW_MEMORY_CACHE=1` | `lib/cacheDb.ts`, `lib/cacheScope.ts`, `lib/memoryDb.ts`, `lib/sqliteRequired.ts` |

Cross-cutting (not a numbered layer): **pathGuard** — every tool path stays under
the trusted ceiling (`lib/pathGuard.ts`). Catalog mode must not widen path
authority past these guards (root `ARCHITECTURE.md` catalog rule 3).

---

## L0 — Catalog mode (schema bloat)

**Env:** `GATE_TOOL_MODE=catalog|full` (default **`catalog`**).
Unknown values fall back to catalog (`resolveToolMode`).

**Catalog core** (`CATALOG_CORE_TOOLS` in `src/lib/toolMode.ts`):

- `gate_help`, `gate_init`
- Hot path: `gate_compress_file`, `gate_graph_query`, `gate_session_stats`
- Escape hatch: `gate_invoke` `{ tool, args }`

**Full mode:** registers every tool in `ALL_GATE_TOOLS` **except** `gate_invoke`
(catalog-only; avoids redundant schema).

`registerGateTool` in `main.ts` skips listing when `shouldRegisterTool` is false
(logs `toolMode=…: not listing <name>`). Long-tail handlers still exist in
`tools/invoke.ts` `HANDLERS` and are reached only via `gate_invoke` in catalog
mode.

Rules (root `ARCHITECTURE.md`):

1. No parallel “search/describe tools” meta-tools — `gate_help` owns docs;
   `gate_invoke` owns dispatch.
2. Do not shrink unrelated MCP servers inside Gate — use proxy tools or leave
   them alone.
3. Catalog must never widen path authority past existing path guards.

---

## L1 — Symbol graph vs graphify

Two complementary graphs; **not duplicates** (root `ARCHITECTURE.md`).

| | Gate symbol graph (L1a) | graphify / graphifyy (L1b) |
|--|------------------------|---------------------------|
| Engine | Node + tree-sitter, in-process (`symbolGraph.ts`) | Python CLI / optional MCP; Gate only **reads** artifacts |
| Focus | Symbols, imports, file edges | Communities, god nodes, docs/media |
| Persistence | Process memory (+ optional HTML export) | `graphify-out/` on disk (`GRAPH_REPORT.md`) |
| When to use | “What calls X?”, file symbols, budgeted `symbol_map` | Architecture map, communities, cross-doc |

**Symbol query types** (`symbolGraph.ts` / `main.ts` schema):
`depends_on` | `dependents` | `file_symbols` | `search` | `stats` |
`symbol_map` | `export_html`.

**Graphify query types:** `graphify_hubs` | `graphify_search` | `graphify_map`
(`graphifyBridge.ts` parses god nodes / community hubs / summary from
`GRAPH_REPORT.md`).

**Bridge behavior** (`tools/graphQuery.ts`):

- Explicit `graphify_*` → `queryGraphifyFromRoot`.
- Symbol `search` with **0 hits** auto-appends graphify search when a report
  exists → `source: "symbol+graphify"`.
- Nested `graphify-out/` discovered by walking up from `projectRoot` / cwd
  (`projectRoot.ts`); optional `GATE_GRAPHIFY_REPORT`.
- `rebuild=true` can run `graphify update .` when CLI is on PATH
  (`graphifyRunner.ts`); stale report warning via `graphifyFreshness.ts`.

**HTML:** Gate exports **its** symbol graph to
`.gate-mcp/symbol-graph.html` (`symbolGraphViz.ts`, CLI `gatemcp graph-html`,
or `queryType=export_html`). That is **not** a graphify HTML clone.

Non-goal: no second knowledge-graph engine competing with graphifyy.

---

## PathGuard

`src/lib/pathGuard.ts` — canonical path-boundary utilities.

- **Trusted ceiling:** `GATE_PROJECT_ROOT` if set, else server startup `cwd`
  (`getAllowedProjectRoot`). Comes from server config, **never** from a bare
  tool argument as a widen.
- **Narrow only:** tool `projectRoot` may select the ceiling or a **nested**
  directory; sibling/parent paths are rejected (`resolveProjectRoot` +
  `assertContained`).
- **API:** `safeResolve`, `safeResolveExistingFile`,
  `safeResolveExistingDirectory`; symlink-aware via `canonicalizePath`
  (nearest existing ancestor + `realpathSync.native`).
- **Always denied:** sensitive patterns (`.ssh`, `.gnupg`, `.aws/credentials`,
  `.netrc`, `etc/passwd|shadow`) even when boundary is disabled.
- **Escape:** `GATE_ALLOW_ANY_PATH=1` disables containment (logs warn) but
  sensitive paths remain denied.

Used across cache, memory, proxy config, symbol HTML export, doctor, and tools
that accept filesystem paths.

---

## Cache partition (L4 scoping)

`src/lib/cacheScope.ts` separates **partition** from **path root**:

| Concept | Resolver | Meaning |
|---------|----------|---------|
| **Partition** | `resolveCachePartitionRoot()` → `getAllowedProjectRoot()` | Single SQLite / memory partition under the trusted ceiling |
| **Path root** | `resolvePathRoot(explicit?)` → `resolveCodeRoot` | Narrowed (or ceiling) root for file path resolution |

Rules (also README multi-repo section):

- Dedup rows **always** live under the trusted ceiling so the same absolute
  file never splits across parent vs child `root_key` partitions.
- Tool `projectRoot` **filters** stats/clear (`getScopedStats` /
  `clearScoped`) to paths under that folder; omit to operate on the whole
  partition.
- Default DB path: `<partition>/.gate-mcp/cache.db`, overridable by
  `GATE_CACHE_DB` (must stay inside the ceiling — `cacheDb.ts` + `safeResolve`).

**SQLite policy** (root `ARCHITECTURE.md` + `sqliteRequired.ts` / `cacheDb.ts`):

- `better-sqlite3` is a **required** dependency.
- Process start **fails** if the module cannot be `require`d, unless
  `GATE_ALLOW_MEMORY_CACHE=1` (tests / emergency).
- If the module loads but the DB file cannot open → in-memory Map; surface
  `fallbackReason` via `gate_init` (`cache.kind`, `cache.partition`,
  `cache.fallbackReason`).
- Doctor `--strict` fails when cache is not persistent.

`gate_memory` uses the same ceiling pattern via `memoryDb.ts` (SQLite or
`.gate-mcp/memory.json` fallback).

---

## Token cost buckets → layers

| Bucket | Gate answer | Layer |
|--------|-------------|-------|
| Schema bloat (`tools/list`) | `GATE_TOOL_MODE=catalog` (or `full`) | L0 |
| Corpus / file bloat | `gate_graph_query` → `gate_compress_file` | L1 → L2 |
| Repeat file bloat | SQLite dedup cache | L4 (+ L2 integration) |
| Tool JSON bloat | `gate_clean_response` / proxy TOON | L3 |
| Assistant output bloat | Host rules — **not Gate** | — |

## Change checklist

When adding a tool or mode (from root `ARCHITECTURE.md`):

1. Fits a token-cost bucket? Else reject or partner externally.
2. Update `gate_help` + root `ARCHITECTURE.md` in the same change.
3. Catalog: add to `CATALOG_CORE_TOOLS` **or** reach only via `gate_invoke`.
4. Keep pathGuard + single cache partition; add unit coverage; keep
   `npm test` / security / doctor green.
