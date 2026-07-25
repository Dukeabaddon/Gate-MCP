# Gate-MCP

## What This Is

Gate-MCP (`@gatemcp/cli`) is a local Model Context Protocol server that compresses repository context, exposes navigation/graph tools, and measures token savings for coding agents (Cursor, Claude Code, and similar). Operators run it as an MCP server or CLI (`gatemcp`) against one or more project roots.

## Core Value

Every tool call must return trustworthy, measurable context compression without leaking paths outside the allowed project root — schema bloat and memory-cache silent failure must stay fixed.

## Requirements

### Validated

<!-- Shipped behavior present in the working tree; verified by local QA 2026-07-25. -->

- ✓ MCP stdio server with tool registration (`src/main.ts`) — catalog mode 6 tools / full mode 12
- ✓ `gate_compress_file` / compress pipeline with optional `projectRoot` narrow-only override
- ✓ Unified cache partition + SQLite-backed cache (required unless `GATE_ALLOW_MEMORY_CACHE=1`)
- ✓ Symbol graph map + HTML export (`gatemcp graph-html` → `.gate-mcp/symbol-graph.html`)
- ✓ Doctor / release-consistency / multi-repo + adversarial QA scripts
- ✓ Catalog progressive disclosure via `gate_invoke` (`GATE_TOOL_MODE=catalog` default)

### Active

- [ ] Ship coherent **v0.5.7**: commit working tree, align README release status, tag, publish `@gatemcp/cli@0.5.7`
- [ ] Confirm consumer MCP pins (Cursor plugin / `.mcp.json`) resolve the published 0.5.7 build
- [ ] Keep GSD planning map fresh after structural changes

### Out of Scope

- Caveman / caveman-shrink integration — explicitly rejected for this product line
- Deeper live graphify MCP bridge — complementary ecosystem; deferred past 0.5.7 ship
- Official TOON / Code Mode ecosystem packaging — P2, not blocking 0.5.7

## Context

- Repo: https://github.com/Dukeabaddon/Gate-MCP
- Workspace path: `Gate-MCP/` under `qc-navigo-site`
- Branch: `fix/qa-055-compress-projectroot`
- Working tree version **0.5.7** (uncommitted relative to last release commit); npm registry historically lagged (see `.planning/codebase/CONCERNS.md`)
- GSD Core installed locally for Cursor (`npx @opengsd/gsd-core@latest --cursor --local --profile=full`) — skills under `.cursor/` (gitignored)
- Codebase map: `.planning/codebase/{STACK,ARCHITECTURE,STRUCTURE,CONVENTIONS,TESTING,INTEGRATIONS,CONCERNS}.md`
- Local proof 2026-07-25: `npm run build` + unit/multi-repo/adversarial + security + MCP acceptance/inspector + doctor + `check:release` + `audit:prod` → **QA_EXIT:0**

## Constraints

- **Runtime**: Node.js `>=20 <27`, ESM, TypeScript → `dist/`
- **Native deps**: `better-sqlite3` / tree-sitter require allow-scripts; SQLite is required for production cache
- **Security**: path containment via project root; no exploit PoCs; proxy disabled by default
- **Process**: conventional commits; do not commit/push/publish unless explicitly asked
- **Design**: no Caveman; Gate owns its symbol graph

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Default `GATE_TOOL_MODE=catalog` + `gate_invoke` | Cut tools/list schema ~64% vs full | ✓ Good (measured) |
| SQLite required (opt-out only via `GATE_ALLOW_MEMORY_CACHE=1`) | Stop silent `(memory)` cache regressions | ✓ Good |
| HTML export for symbol graph | Operator-visible map without external viz stack | ✓ Good |
| No Caveman integration | Product boundary; Gate has its own compression path | ✓ Good |
| GSD brownfield onboard before next feature work | Plans must follow real stack/conventions/concerns | — Pending use |

---
*Last updated: 2026-07-25 after GSD map + full local QA*
