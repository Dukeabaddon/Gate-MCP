# GATEMCP: Context Compression Gateway
## Session Handoff — v0.3.0

> **For Cursor / Windsurf / Claude Code / Antigravity agents:**
> Read this file FIRST to understand the full project context before making changes.

> **Rename note:** Package was originally `gate-mcp`. That name was taken on npm by Gate.io (crypto exchange). v0.3.0 renamed to **`gatemcp`** to avoid the collision.

---

## 1. WHAT THIS IS

**gatemcp** is a local MCP server that compresses AI context at 5 layers before it reaches the LLM, saving 37–99% of input tokens. It is a single `npm` binary with zero cloud dependencies.

```bash
# Local install (npm publish pending)
git clone https://github.com/Dukeabaddon/Gate-MCP.git
cd Gate-MCP && npm install --legacy-peer-deps && npm run build
```

**Current state (verified 2026-05-15):** v0.3.0, 7 tools, 13 unit + 53 stress tests passing, multi-language support (12 native AST + 11 regex fallback), experimentally validated on 6,115-file repos.

---

## 2. THE 5-LAYER ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────┐
│  L0  SCHEMA COMPRESSION     gate_help + terse descriptions  │
│       → 46% saved (347→188 tokens on tool definitions)      │
├─────────────────────────────────────────────────────────────┤
│  L1  NAVIGATION              gate_graph_query               │
│       → 93-99% saved via BFS/DFS symbol dependency graph    │
│       → Tested: 6,115 files (VSCode), 3.2s build, 8ms QPS  │
├─────────────────────────────────────────────────────────────┤
│  L2  INPUT COMPRESSION       gate_compress_file + dedup     │
│       → 46-94% saved via AST signature extraction           │
│       → SHA-256 dedup prevents repeated reads               │
├─────────────────────────────────────────────────────────────┤
│  L3  RESPONSE CLEANING       gate_clean_response            │
│       → 37-81% saved via TOON notation                      │
│       → Pipe escaping for special characters (¦)            │
├─────────────────────────────────────────────────────────────┤
│  L4  OUTPUT COMPRESSION      Caveman (external ecosystem)   │
│       → 60-75% saved on AI text output                      │
│       → Recommended, not built-in                           │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. TOOL INVENTORY

| # | Tool | Purpose | Key Params | Savings |
|---|---|---|---|---|
| 1 | `gate_optimize_image` | OCR/downscale images | `imagePath`, `intent` | 76-97% |
| 2 | `gate_compress_file` | AST code compression | `filePath`, `depth` | 46-94% |
| 3 | `gate_graph_query` | Symbol dependency graph | `query`, `queryType` | 93-99% |
| 4 | `gate_memory` | Cross-session persistence | `action`, `key`, `value` | N/A |
| 5 | `gate_dedup_context` | SHA-256 session dedup | `action` | ~93% reread |
| 6 | `gate_clean_response` | TOON JSON compressor | `data`, `format` | 37-81% |
| 7 | `gate_help` | Full docs on demand | `tool` | 46% schema |

---

## 4. PROJECT STRUCTURE

```
gate-mcp/
├── src/
│   ├── main.ts                  # MCP server entrypoint (stdio transport)
│   ├── types.ts                 # All TypeScript interfaces
│   ├── test.ts                  # 13 unit tests
│   ├── stress-test.ts           # 50 stress tests
│   ├── scale-test.ts            # FAIROS Experiment #1 (6K file test)
│   ├── exp2-semantic.ts         # FAIROS Experiment #2 (semantic quality)
│   ├── exp3-toon.ts             # FAIROS Experiment #3 (TOON consumption)
│   ├── tools/
│   │   ├── optimizeImage.ts     # Layer 2 — OCR + downscale
│   │   ├── compressFile.ts      # Layer 2 — AST extraction
│   │   ├── graphQuery.ts        # Layer 1 — BFS/DFS graph
│   │   ├── memory.ts            # Persistence — JSON file store
│   │   ├── dedupContext.ts      # Layer 2 — SHA-256 cache
│   │   ├── cleanResponse.ts     # Layer 3 — TOON converter
│   │   └── help.ts              # Layer 0 — Documentation registry
│   └── lib/
│       ├── symbolGraph.ts       # In-memory adjacency list engine
│       ├── astParser.ts         # tree-sitter AST extraction
│       ├── tokenCounter.ts      # Token estimation (chars/3.5)
│       └── logger.ts            # Structured stderr logger
├── documentation/               # This folder — hackathon context
├── vendor/graphify/             # Graphify source (reference/study)
├── package.json
├── tsconfig.json
└── .gitignore
```

---

## 5. TECH STACK

| Component | Technology | Why |
|---|---|---|
| Runtime | Node.js ≥20 + TypeScript ESM | Universal MCP compatibility |
| MCP SDK | `@modelcontextprotocol/sdk` ^1.12.1 | Official SDK, stdio transport |
| AST Parser | `tree-sitter` 0.21 + 10 native language grammars (optional deps) | Deterministic, regex fallback for 11 more languages |
| Graph | In-memory adjacency list (Map) + manifest-hash cache invalidation | Zero deps, <100ms queries, stale-safe |
| Persistence | JSON file (`.gate-mcp/memory.json`) | Zero DB dependencies (SQLite migration planned v0.4) |
| Image | `sharp` 0.33 + `jimp` 1.6 fallback + `tesseract.js` 5.1 | Local OCR, no cloud APIs |
| Tokens | `gpt-tokenizer` 2.8 | Real BPE counts, not char/3.5 estimate |
| Path safety | Custom `pathGuard.ts` boundary check | Blocks `~/.ssh`, `/etc/passwd`, traversal attempts |
| Validation | Zod | MCP-standard input validation |

---

## 6. WHAT'S BEEN VALIDATED (3 FAIROS Experiments)

| # | Experiment | Result | Data Point |
|---|---|---|---|
| 1 | **Scale** — VSCode 6,115 TS files | ✅ PASSED | 3.2s build, 25MB, 8ms search |
| 2 | **Semantic Quality** — API surface retention | ✅ 100% | 21/21 exports, 49/49 imports |
| 3 | **TOON Consumption** — Parse fidelity | ✅ 100% | 17/17 fields, 15/15 values |

---

## 7. GIT HISTORY (Conventional Commits, latest first)

Inspect with `git log --oneline`. As of 2026-05-15 the repo has 6+ commits on `main`, tracked at `https://github.com/Dukeabaddon/Gate-MCP`. v0.3.0 commit adds: TSX grammar fix, path-traversal guard, cache-staleness fix, OCR shutdown handler, 10-language native parser support, npm rename.

---

## 8. HOW TO BUILD & TEST

```bash
# Install dependencies
npm install

# Build
npx tsc

# Run unit tests (13 tests)
node dist/test.js

# Run stress tests (50 tests)
node dist/stress-test.js

# Run scale test (requires cloned repos)
node dist/scale-test.js

# Start MCP server
node dist/main.js
```

---

## 9. MCP CLIENT CONFIG

```json
{
  "mcpServers": {
    "gatemcp": {
      "command": "node",
      "args": ["/absolute/path/to/Gate-MCP/dist/main.js"]
    }
  }
}
```

Optional env vars: `GATE_PROJECT_ROOT` (path boundary), `GATE_MAX_FILES` (graph index cap, default 5000, hard cap 50000), `GATE_ALLOW_ANY_PATH=1` (disables boundary — not recommended).

Works with: Cursor, Windsurf, Claude Code, Antigravity, VS Code Copilot.

---

## 10. KNOWN ISSUES & EDGE CASES

1. **Pipe in TOON values** — Fixed: `|` → `¦` (broken bar) in earlier commit
2. **tree-sitter fallback** — Some large TS files trigger `Invalid argument`, regex fallback handles them
3. **TSX grammar** — Fixed v0.3.0: `.tsx` now uses the JSX-aware tsx grammar (was using non-TSX grammar previously, partial parse failures on JSX syntax)
4. **Memory concurrency** — No file locking on `.gate-mcp/memory.json`. Safe for single-user, not for team/multi-session
5. **RSS memory** — 820MB RSS after indexing 6K files. Heap is only 46MB — Node.js behavior
6. **Path safety** — Fixed v0.3.0: all tool handlers now reject paths outside `GATE_PROJECT_ROOT` (defaults to `process.cwd()`). Sensitive paths blocked unconditionally.
7. **Cache staleness** — Fixed v0.3.0: symbol graph cache now keyed by manifest hash (path + mtime + size SHA-256). Modified files trigger automatic rebuild.
8. **OCR worker lifecycle** — Fixed v0.3.0: SIGINT/SIGTERM/beforeExit handlers now call `terminateOcr()` for graceful shutdown.
9. **File discovery cap** — Configurable via `GATE_MAX_FILES` env var (default 5000, hard cap 50000). Logs warning when cap is hit.
10. **VB.NET, Dart** — Not supported (no maintained tree-sitter parser).
