# External Integrations

**Analysis Date:** 2026-07-25

## APIs & External Services

**MCP host clients (stdio):**
- Cursor, Claude Code, Windsurf, Antigravity, VS Code Copilot, and other MCP-over-stdio hosts — Gate does not call cloud APIs for core compression; hosts spawn `gatemcp` and speak JSON-RPC on stdio (`src/main.ts`; `README.md` Usage / Configure your IDE)
  - SDK/Client: `@modelcontextprotocol/sdk` server (`McpServer`, `StdioServerTransport`)
  - Auth: Not applicable (local process; path authority via `GATE_PROJECT_ROOT` / `src/lib/pathGuard.ts`)

**Downstream MCP proxy (opt-in):**
- User-configured MCP servers listed in `.gate-mcp/proxy-servers.json` — spawned as child stdio clients for `gate_proxy_tools` / `gate_proxy_call` (`src/lib/proxyClient.ts`, `src/tools/proxyTools.ts`)
  - SDK/Client: MCP SDK `Client` + `StdioClientTransport`
  - Auth: Per downstream server `env` in proxy config (example tokens in `.gate-mcp/proxy-servers.example.json`); Gate itself requires `GATE_ENABLE_PROXY=1`
  - Disabled by default (`ARCHITECTURE.md` / `README.md` Known limitations)

**Graphify (peer knowledge-graph product):**
- Reads on-disk `graphify-out/GRAPH_REPORT.md` (auto-discover / `GATE_GRAPHIFY_REPORT`) — L1b bridge, not an owned graph engine (`ARCHITECTURE.md` Two graphs; `src/lib/graphifyBridge.ts`, `src/tools/graphQuery.ts`)
  - Query types: `graphify_hubs`, `graphify_search`, `graphify_map`; symbol `search` may append graphify fallback
  - Optional CLI: `graphify --version` / `graphify update .` when on PATH (`src/lib/graphifyRunner.ts`); install message references `pip install graphifyy`
  - Freshness: `src/lib/graphifyFreshness.ts`; health surface: `src/tools/gateInit.ts`

**Optional LLM validation (non-core):**
- `gate_validate_compression` providers in `src/lib/llmProvider.ts`: `mock` (default, no network), `ollama` (local HTTP), `openai` / OpenAI-compatible (`OPENAI_API_KEY`, optional `OPENAI_BASE_URL`)
  - Core pipeline needs no hosted model (`ARCHITECTURE.md` Non-goals; `README.md` Tech Stack)

## Data Storage

**Databases:**
- SQLite via `better-sqlite3` `12.10.0` — **required** dependency (`package.json`; `ARCHITECTURE.md` SQLite policy)
  - Default path: `<GATE_PROJECT_ROOT>/.gate-mcp/cache.db` (override `GATE_CACHE_DB`); must remain under trusted ceiling
  - Client: `src/lib/cacheDb.ts` (dedup `cache_entries_v3`, WAL); `src/lib/memoryDb.ts` (`memory_entries_v2` for `gate_memory`)
  - Startup: `assertSqliteModuleOrExit()` in `src/main.ts` / `src/lib/sqliteRequired.ts`
  - Fallback: in-memory Map / JSON memory only if DB open fails or `GATE_ALLOW_MEMORY_CACHE=1` (surfaced via `gate_init`)

**File Storage:**
- Local filesystem only under trusted project root — compressed views, `.gate-mcp/` artifacts, optional symbol HTML export `.gate-mcp/symbol-graph.html` (`src/lib/symbolGraphViz.ts`, `gatemcp graph-html` in `src/main.ts`)
- Graphify artifacts: `graphify-out/` on disk (partner-owned; Gate reads, does not replace)

**Caching:**
- Persistent SQLite dedup cache (same DB file as above) — `src/lib/cacheDb.ts`, tool `src/tools/dedupContext.ts`
- Process-local symbol graph cache — `src/lib/symbolGraph.ts`
- No Redis / remote cache detected

## Authentication & Identity

**Auth Provider:**
- Not applicable for Gate core — no user accounts or OAuth in the Gate binary
- Downstream MCP servers may require their own credentials in proxy `env` (e.g. `GITHUB_PERSONAL_ACCESS_TOKEN` in `.gate-mcp/proxy-servers.example.json`)
- Path security is the primary trust boundary (`GATE_PROJECT_ROOT`, blocked sensitive paths in `README.md` Security / `src/lib/pathGuard.ts`)

## Monitoring & Observability

**Error Tracking:**
- None detected (no Sentry/Datadog SDK in `package.json`)

**Logs:**
- stderr-only structured logger (`src/lib/logger.ts`) — stdout reserved for MCP JSON-RPC (`src/main.ts` header)
- Session/tool payload metrics via `gate_session_stats` (`src/tools/sessionStats.ts`, `src/lib/sessionMetrics.ts`); `billingScope: tool_payload_only`

**Diagnostics:**
- `gatemcp doctor` — executable, deps, permissions, SQLite probe, MCP initialize, `tools/list` (`src/doctor.ts`; `README.md` Installation diagnostics)

## CI/CD & Deployment

**Hosting:**
- npm registry package `@gatemcp/cli` (binary `gatemcp`); project site `https://gate-mcp-site.vercel.app/` (`package.json` `homepage`)
- No server-side Gate cloud deployment — runs on the user's machine inside the IDE MCP host

**CI Pipeline:**
- GitHub Actions — `.github/workflows/ci.yml`
  - Platform matrix: ubuntu/windows/macos × Node 20/22/24/26 (with OS/node excludes)
  - Acceptance job: Node 26, npm 12 policy check, `npm run qa`, `npm run test:plugin`, `npm pack --dry-run`

**Distribution plugins / IDE helpers:**
- **Codex plugin** (checked-in): `plugins/gatemcp/` — `.codex-plugin/plugin.json` + `.mcp.json` pins `npm exec … --package=@gatemcp/cli@0.5.7 -- gatemcp` with native allow-scripts; marketplace entry `.agents/plugins/marketplace.json`
- **Cursor integration:** documented MCP config in workspace `.cursor/mcp.json` (`README.md`); Cursor may show server as `user-gatemcp`. Snippet pack `vscode-extension/snippets/gatemcp.code-snippets` prefix `gatemcp-cursor-mcp` for Cursor MCP JSON (`vscode-extension/README.md`). No separate Cursor Marketplace extension package detected beyond local snippet helper
- **VS Code:** snippet extension folder `vscode-extension/` (not Marketplace-published per `README.md` Release status)

## Environment Configuration

**Required / important env vars:**
- `GATE_PROJECT_ROOT` — trusted path ceiling (defaults to process cwd when unset)
- `GATE_CACHE_DB` — SQLite location under trusted ceiling
- Native install allowlist for `better-sqlite3`, `sharp`, `tesseract.js`, `tree-sitter*` (install-time, not runtime)
- Proxy: `GATE_ENABLE_PROXY=1` plus `.gate-mcp/proxy-servers.json`
- Emergency: `GATE_ALLOW_MEMORY_CACHE=1`
- Optional: `GATE_TOOL_MODE`, `GATE_GRAPHIFY_REPORT`, `GATE_MAX_FILES`, `GATE_MAX_FILE_BYTES`, `GATE_ALLOW_ANY_PATH`, `GATE_PROXY_TIMEOUT_MS`
- Optional validation: `OPENAI_API_KEY` / `OPENAI_BASE_URL` (openai provider only)

**Secrets location:**
- Not shipped by Gate; downstream MCP tokens live in local proxy/IDE config (see `.gate-mcp/proxy-servers.example.json`)
- No cloud secrets required for core Gate operation

## Webhooks & Callbacks

**Incoming:**
- None — Gate is not an HTTP server; transport is MCP stdio

**Outgoing:**
- Optional child process spawns: downstream MCP servers (`src/lib/proxyClient.ts`); optional `graphify update .` (`src/lib/graphifyRunner.ts`); optional Ollama/OpenAI HTTP for validation only (`src/lib/llmProvider.ts`)

---

*Integration audit: 2026-07-25*
*Update when adding/removing external services*
