# Technology Stack

**Analysis Date:** 2026-07-25

## Languages

**Primary:**
- TypeScript 5.7 (`typescript` in `package.json` `devDependencies`; `tsconfig.json` targets `ES2022`, `module`/`moduleResolution` `Node16`) — all application code under `src/`

**Secondary:**
- JavaScript (ESM `.mjs` scripts under `scripts/`; compiled output under `dist/`) — QA, MCP acceptance, package/plugin checks
- Node native addons (C/C++ via npm install scripts) — `better-sqlite3`, `tree-sitter` (+ grammars), `sharp`

## Runtime

**Environment:**
- Node.js `>=20.0.0 <27` (`package.json` `engines`)
- ESM package (`"type": "module"`); binary entry `gatemcp` → `dist/main.js`
- Version string `0.5.7` in `package.json` and `src/version.ts` (`GATEMCP_VERSION`)

**Package Manager:**
- npm (lockfile: `package-lock.json` present)
- Native installs require npm allow-scripts / `--strict-allow-scripts` allowlist (documented in `README.md` Installation; mirrored in `package.json` `allowScripts`)

## Frameworks

**Core:**
- Model Context Protocol server — `@modelcontextprotocol/sdk` `^1.12.1`
  - Server: `McpServer` + `StdioServerTransport` in `src/main.ts`
  - Downstream proxy client: `Client` + `StdioClientTransport` in `src/lib/proxyClient.ts`
- Zod `^3.24.4` — tool `inputSchema` validation in `src/main.ts`

**Testing:**
- No separate test framework package — built TypeScript runners (`node dist/test.js`, `dist/security-regression.js`, `dist/storage-regression.js`, `dist/stress-test.js`) plus `scripts/*.mjs` acceptance/QA suites (`package.json` `scripts`)

**Build/Dev:**
- `tsc` (`npm run build` / `npm run dev` watch) — `tsconfig.json` → `dist/`
- GitHub Actions matrix Node 20/22/24/26 — `.github/workflows/ci.yml`

## Key Dependencies

**Critical:**
- `@modelcontextprotocol/sdk` `^1.12.1` — MCP stdio server and optional downstream MCP proxy (`src/main.ts`, `src/lib/proxyClient.ts`)
- `better-sqlite3` `12.10.0` — **required** native SQLite (WAL) for dedup cache + `gate_memory`; startup fails if module cannot load unless `GATE_ALLOW_MEMORY_CACHE=1` (`src/lib/sqliteRequired.ts`, `src/lib/cacheDb.ts`, `src/lib/memoryDb.ts`; policy in `ARCHITECTURE.md`)
- `tree-sitter` `0.21.1` + core grammars (`tree-sitter-javascript`, `tree-sitter-typescript`, `tree-sitter-python`) — AST signatures / symbol graph (`src/lib/astParser.ts`, `src/lib/symbolGraph.ts`); additional grammars as `optionalDependencies`
- `sharp` `0.35.3` (primary) + `jimp` `^1.6.0` (fallback) — image metadata/resize (`src/lib/imageProcessor.ts`)
- `tesseract.js` `5.1.1` — local OCR (`src/lib/imageProcessor.ts`)
- `gpt-tokenizer` `^2.8.1` — BPE token counts (`src/lib/tokenCounter.ts`)
- `zod` `^3.24.4` — MCP tool argument schemas (`src/main.ts`)

**Infrastructure:**
- Optional tree-sitter language packs (`package.json` `optionalDependencies`) — load failures degrade to regex/direct extraction (`src/lib/astParser.ts` header comments; `README.md` Language Support)
- No cloud runtime or hosted model required for core pipeline (`README.md` Tech Stack; `ARCHITECTURE.md` product boundary)

## Configuration

**Environment:**
- Process env (no committed `.env` required for core MCP). Key vars from `README.md` Security / Usage and `src/lib/*`:
  - `GATE_PROJECT_ROOT` — trusted path ceiling (`src/lib/pathGuard.ts`, `src/lib/projectRoot.ts`)
  - `GATE_CACHE_DB` — SQLite path under trusted ceiling (`src/lib/cacheDb.ts`)
  - `GATE_TOOL_MODE` — `catalog` (default) | `full` (`src/lib/toolMode.ts`; `ARCHITECTURE.md`)
  - `GATE_ALLOW_MEMORY_CACHE` — emergency skip of SQLite module check (`src/lib/sqliteRequired.ts`)
  - `GATE_ALLOW_ANY_PATH`, `GATE_MAX_FILES`, `GATE_MAX_FILE_BYTES`
  - `GATE_GRAPHIFY_REPORT` — absolute `GRAPH_REPORT.md` override
  - `GATE_ENABLE_PROXY`, `GATE_PROXY_TIMEOUT_MS` — proxy mode (`src/lib/proxyClient.ts`)
  - Optional validation only: `OPENAI_API_KEY`, `OPENAI_BASE_URL`, Ollama HTTP (`src/lib/llmProvider.ts`)
- Proxy roster file: `.gate-mcp/proxy-servers.json` (example: `.gate-mcp/proxy-servers.example.json`)

**Build:**
- `tsconfig.json` — compile `src/**/*` → `dist/`
- `package.json` `bin` / `files` — publish `dist/**/*.js` + `d.ts`, `README.md`, `LICENSE`, `ARCHITECTURE.md`

## Platform Requirements

**Development:**
- Node 20–26 with native toolchain able to build reviewed allowlisted packages (`better-sqlite3`, `sharp`, `tesseract.js`, `tree-sitter` + grammars)
- Optional peer CLI `graphify` on PATH for map rebuild (`src/lib/graphifyRunner.ts`; install hint `pip install graphifyy`)
- Optional graphify artifact tree: `graphify-out/GRAPH_REPORT.md` (read by `src/lib/graphifyBridge.ts`)

**Production:**
- Distributed as npm package `@gatemcp/cli` (CLI binary `gatemcp`); homepage `https://gate-mcp-site.vercel.app/`
- Runs locally as MCP over stdio inside host IDEs (Cursor, Claude Code, Windsurf, Antigravity, VS Code Copilot — `README.md` Configure your IDE)
- CI: `.github/workflows/ci.yml` (platform matrix + `npm run qa` acceptance on Node 26 / npm 12)

---

*Stack analysis: 2026-07-25*
*Update after major dependency changes*
