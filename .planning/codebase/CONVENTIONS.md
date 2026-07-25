# Coding Conventions

**Analysis Date:** 2026-07-25

## Naming Patterns

**Files:**
- Tool handlers: camelCase file matching the MCP tool without the `gate_` prefix — e.g. `src/tools/compressFile.ts` → `gate_compress_file`
- Shared libs: camelCase under `src/lib/` — e.g. `pathGuard.ts`, `toolMode.ts`, `tokenCounter.ts`
- Regression / suite entrypoints at `src/` root: kebab-or-descriptive names — `test.ts`, `security-regression.ts`, `storage-regression.ts`, `stress-test.ts`, `doctor.ts`
- Standalone Node scripts: kebab-case `.mjs` under `scripts/` — e.g. `qa-adversarial-audit.mjs`, `test-mcp-acceptance.mjs`

**Functions:**
- Tool entrypoints: `handleX` — `handleCompressFile`, `handleGraphQuery`, `handleInvoke` (`src/tools/*.ts`)
- Pure helpers: camelCase verbs — `resolveToolMode`, `shouldRegisterTool`, `safeResolveExistingFile`
- Test-only resets: underscore-prefixed — `_resetSessionMeasurementsForTests`, `_resetMemoryDbForTests`

**Variables:**
- camelCase locals; `SCREAMING_SNAKE` for module constants — `CATALOG_CORE_TOOLS`, `ALL_GATE_TOOLS`, `EXPECTED_TOOLS`, `GATEMCP_VERSION`

**Types:**
- `export type` for unions/aliases — `ToolMode`, `DoctorStatus`, `MemoryAction`
- `export interface` for input/result shapes — `GraphQueryInput`, `DoctorReport`, `InvokeResult`
- MCP tool names as string literals matching `gate_*` snake_case

## Code Style

**Formatting:**
- No Prettier / Biome / ESLint config detected in the repo root
- Rely on TypeScript `strict: true` (`tsconfig.json`) as the primary static gate
- Prefer concise, explicit control flow over heavy abstraction

**Linting:**
- Not detected (no `.eslintrc*`, `eslint.config.*`, or `biome.json`)
- Quality gate is compile + scripted test suites (`npm run qa`), not a linter

**TypeScript / ESM (required):**
- `"type": "module"` in `package.json` — treat the package as native ESM
- `tsconfig.json`: `"module": "Node16"`, `"moduleResolution": "Node16"`, `"target": "ES2022"`, `outDir: dist`, `rootDir: src`
- Relative imports **must** use `.js` extensions in TypeScript sources (Node16 emit) — e.g. `import { handleHelp } from "./tools/help.js"`
- Node built-ins via `node:` protocol — `import fs from "node:fs"`, `import path from "node:path"`
- Standalone QA scripts are plain ESM `.mjs` with `#!/usr/bin/env node` and `import.meta.dirname` for repo root resolution
- Runtime: Node `>=20.0.0 <27` (`package.json` `engines`)

## Import Organization

**Order (observed in `src/main.ts`, `src/test.ts`):**
1. Node built-ins (`node:fs`, `node:path`, `node:os`, …)
2. External packages (`@modelcontextprotocol/sdk/...`, `zod`)
3. Local `./lib/*.js` then `./tools/*.js` (or sibling modules)
4. Version / doctor / mode helpers last when needed

**Path Aliases:**
- Not detected — always relative imports with `.js` suffix

**Dynamic imports:**
- Allowed for late-binding tests and scripts — e.g. `await import("./lib/toolMode.js")` in `src/test.ts`, `await import("../dist/tools/compressFile.js")` in `scripts/*.mjs`

## Error Handling

**Patterns:**
- Handlers throw `Error` with actionable messages (`outside project boundary`, `sensitive path`, `File not found`)
- Path safety centralized in `src/lib/pathGuard.ts` (`safeResolve`, `safeResolveExistingFile`, `resolveProjectRoot`)
- MCP acceptance / QA scripts assert `message.error` or `result.isError` for invalid calls (`scripts/test-mcp-acceptance.mjs`)
- Regression suites use `node:assert/strict` (`assert.throws`, `assert.rejects`) — see `src/security-regression.ts`
- Process-level: suite `main()` / `runTests()` catch fatals, write to stderr, set `process.exitCode = 1` or `process.exit(1)`

## Logging

**Framework:** Custom logger at `src/lib/logger.js` (imported as `logger` from `./lib/logger.js` in `src/main.ts`)

**Patterns:**
- Operational noise on **stderr** — never pollute MCP stdout JSON-RPC
- Tests print progress to `console.error` with `PASS` / `FAIL` markers (`src/test.ts`)
- Acceptance asserts logs stay off the JSON-RPC channel: stderr may contain `[gate-mcp]`-style lines; stdout messages must not (`scripts/test-mcp-acceptance.mjs`)
- `DISABLE_CONSOLE_OUTPUT=true` used by doctor / inspector / adversarial spawns to quiet children

## Comments

**When to Comment:**
- File-level purpose banners on suites and mode modules (`src/lib/toolMode.ts`, `src/security-regression.ts`, `scripts/qa-adversarial-audit.mjs`)
- Non-obvious security / schema-budget invariants inline (catalog vs full, doctor forcing catalog)

**JSDoc/TSDoc:**
- Light — short block comments preferred over exhaustive JSDoc
- Tool/module headers describe behavior and env flags when they affect the public surface

## Function Design

**Size:** Prefer focused `handle*` + small helpers; keep path/policy logic in `src/lib/`

**Parameters:** Object args for tools (`args: CompressFileInput`-style or inline object types); options bags for doctor (`runDoctor({ strict, json, … })`)

**Return Values:** Structured result objects with savings / notes / status fields — mirror MCP JSON text payloads

## Module Design

**Exports:** Named exports for handlers, types, and pure helpers; avoid default exports except established utilities (e.g. logger)

**Barrel Files:** Not detected — import concrete modules

**Published surface:**
- Ship `dist/**/*.js` + `.d.ts`; exclude test/regression artifacts via `package.json` `files` negations (`!dist/test.*`, `!dist/security-regression.*`, …)
- CLI bin: `gatemcp` → `dist/main.js`

## Commits

**Conventional commits (required):**
- Use Conventional Commit prefixes observed in history: `feat`, `fix`, `chore`, `docs`, `test`, `release`
- Scope or version tag optional — e.g. `feat(v0.5.5): …`, `fix: close … QA gaps`, `test: track … fixture`
- Keep messages imperative and focused on why; one logical change per commit when practical

## Schema Surface (`GATE_TOOL_MODE`)

**Product default:** `catalog` (`src/lib/toolMode.ts` — unknown values fall back to `catalog`)

**Rules when adding tools:**
1. Register the MCP tool name in `ALL_GATE_TOOLS` when it is a real Gate tool
2. Add hot-path tools to `CATALOG_CORE_TOOLS` only if they belong in the small `tools/list`
3. Long-tail tools stay callable via `gate_invoke` in catalog mode (`src/tools/invoke.ts`)
4. `gate_invoke` is **catalog-only** — `shouldRegisterTool` returns false for it in `full` mode
5. Doctor, MCP acceptance, and inspector **lock** `GATE_TOOL_MODE=catalog`; multi-repo / adversarial path probes use `full` so long-tail tools appear in `tools/list`

**Catalog core set** (`CATALOG_CORE_TOOLS` in `src/lib/toolMode.ts`):
`gate_help`, `gate_init`, `gate_compress_file`, `gate_graph_query`, `gate_session_stats`, `gate_invoke`

## Env & Safety Conventions

- Prefer `GATE_PROJECT_ROOT` + path guard over trusting process cwd alone
- Proxy execution opt-in: `GATE_ENABLE_PROXY=1` (disabled by default; covered in `src/security-regression.ts`)
- Do not enable `GATE_ALLOW_ANY_PATH` in tests unless the case explicitly exercises that escape hatch
- Keep secrets / sensitive path denials (`.ssh`, `.aws`) enforced through `pathGuard`

---

*Convention analysis: 2026-07-25*
