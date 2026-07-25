# Gate MCP architecture

Single source of truth for how Gate saves tokens, what it owns vs partners, and
how new features must fit. Keep this document thinner than the code.

## Product boundary

Gate is a **local MCP compression gateway**. Agents call Gate tools; Gate does
not intercept editor `Read`/`Bash` automatically.

**In scope:** schema surface control, code navigation, file/AST compression,
JSON/TOON cleaning, durable dedup + KV, optional MCP proxy compression,
image OCR/downscale, measured tool-payload metrics.

**Out of scope:** rewriting assistant chat style (no Caveman or output-voice
integration), owning a full corpus knowledge-graph product (that is graphifyy),
owning a Code Mode sandbox runtime.

## Token cost buckets

| Bucket | Gate answer |
|--------|-------------|
| Schema bloat (`tools/list`) | `GATE_TOOL_MODE=catalog` (recommended) or `full` |
| Corpus / file bloat | `gate_graph_query` → `gate_compress_file` |
| Repeat file bloat | SQLite dedup cache (required dependency) |
| Tool JSON bloat | `gate_clean_response` / proxy TOON |
| Assistant output bloat | Host rules / user preference — **not Gate** |

## Pipeline (call order)

```
1. gate_init                         # health: SQLite, graphify path, toolMode
2. gate_graph_query                  # navigate (symbol and/or graphify)
3. gate_compress_file                # hydrate only the files you need
4. gate_clean_response / proxy_call  # shrink structured JSON if needed
5. gate_session_stats                # measured tool-payload accounting only
```

`gate_help tool=recommended_stack` is the agent-facing version of this pipeline.

## Layer model

| Layer | Name | Mechanism |
|-------|------|-----------|
| L0 | Tool surface | Catalog mode exposes a small core + `gate_invoke`; full mode lists all tools |
| L1a | Symbol graph | In-process tree-sitter import/call graph (`symbolGraph.ts`) |
| L1b | Graphify bridge | Reads `graphify-out/` (communities / god nodes); does not replace L1a |
| L2 | File compress | AST signature / structure / summary / full |
| L3 | Response clean | TOON / compact / whitelist |
| L4 | Persistence | **Required** `better-sqlite3` WAL DB; memory Map only if open fails or `GATE_ALLOW_MEMORY_CACHE=1` |

## Two graphs (not duplicates)

| | Gate symbol graph | graphifyy |
|--|------------------|-----------|
| Engine | Node + tree-sitter, in-process | Python CLI / optional MCP |
| Focus | Symbols, imports, file edges | Communities, god nodes, docs/media |
| Persistence | Process memory (+ optional HTML export) | `graphify-out/` on disk |
| When to use | “What calls X?”, file symbols, budgeted symbol map | Architecture map, communities, cross-doc |

HTML view: Gate can export **its** symbol graph to `.gate-mcp/symbol-graph.html`
(`gate_graph_query` `queryType=export_html` or `gatemcp graph-html`). That is
not a graphify HTML clone; use graphify’s own viz for community maps.

## Catalog mode (schema bloat)

Env: `GATE_TOOL_MODE=catalog|full` (default **`catalog`**).

**Catalog exposes**

- `gate_help`, `gate_init`
- Hot path: `gate_compress_file`, `gate_graph_query`, `gate_session_stats`
- Escape hatch: `gate_invoke` `{ tool, args }` for every other Gate tool

**Full** registers every tool directly (legacy / debugger friendly).

Rules:

1. Do not add parallel “search tools / describe tools” meta-tools — `gate_help`
   already owns docs; `gate_invoke` owns dispatch.
2. Do not shrink unrelated MCP servers inside Gate — use Gate proxy tools or
   leave them alone.
3. Catalog must never widen path authority past existing path guards.

## SQLite policy

- `better-sqlite3` is a **required** dependency (install scripts must be allowed).
- Process start **fails** if the module cannot be `require`d, unless
  `GATE_ALLOW_MEMORY_CACHE=1` (tests / emergency only).
- If the module loads but the DB file cannot open, Gate may fall back to an
  in-memory Map and must surface `fallbackReason` via `gate_init`.
- Doctor `--strict` fails when cache is not persistent.

## Non-goals / anti-redundancy

- No Caveman (or other reply-style) integration in the Gate binary or plugin.
- No second knowledge-graph engine competing with graphifyy.
- No Code Mode sandbox inside Gate.
- No LLMLingua-style token deletion on source code.

## Change checklist

When adding a tool or mode:

1. Does it fit a bucket above? If not, reject or partner externally.
2. Update `gate_help` + this doc in the same change.
3. Catalog: either add to the small core set or reachable only via `gate_invoke`.
4. Add unit coverage + keep `npm test` / security / doctor green.
