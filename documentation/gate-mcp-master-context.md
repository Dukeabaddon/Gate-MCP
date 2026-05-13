# GATE-MCP: Context Compression Gateway
## Hackathon Session Handoff — v0.2.0-alpha

> **For Cursor / Windsurf / Claude Code / Antigravity agents:**
> Read this file FIRST to understand the full project context before making changes.

---

## 1. WHAT THIS IS

**gate-mcp** is a local MCP server that compresses AI context at 5 layers before it reaches the LLM, saving 37–99% of input tokens. It is a single `npm` binary with zero cloud dependencies.

```
npm install -g gate-mcp
```

**Current state:** v0.2.0-alpha, 7 tools, 63/63 tests, 3 git commits, experimentally validated on 6,115-file repos.

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
| Runtime | Node.js + TypeScript ESM | Universal MCP compatibility |
| MCP SDK | `@anthropic-ai/sdk` McpServer | Official SDK, stdio transport |
| AST Parser | `tree-sitter` + `tree-sitter-typescript` | Deterministic, no LLM needed |
| Graph | In-memory adjacency list (Map) | Zero deps, <100ms queries |
| Persistence | JSON file (`.gate-mcp/memory.json`) | Zero DB dependencies |
| Image | `sharp` + `tesseract.js` | Local OCR, no cloud APIs |
| Validation | Zod | MCP-standard input validation |

---

## 6. WHAT'S BEEN VALIDATED (3 FAIROS Experiments)

| # | Experiment | Result | Data Point |
|---|---|---|---|
| 1 | **Scale** — VSCode 6,115 TS files | ✅ PASSED | 3.2s build, 25MB, 8ms search |
| 2 | **Semantic Quality** — API surface retention | ✅ 100% | 21/21 exports, 49/49 imports |
| 3 | **TOON Consumption** — Parse fidelity | ✅ 100% | 17/17 fields, 15/15 values |

---

## 7. GIT HISTORY (Conventional Commits)

```
3956e22 feat: implement Layer 0 schema compression + gate_help meta-tool
b3ca3cf test: add FAIROS experiments — scale, semantic quality, TOON consumption
1d6bc46 feat: implement symbol graph, memory persistence, and TOON response compression
```

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
    "gate": {
      "command": "node",
      "args": ["/path/to/gate-mcp/dist/main.js"]
    }
  }
}
```

Works with: Cursor, Windsurf, Claude Code, Antigravity, VS Code Copilot.

---

## 10. KNOWN ISSUES & EDGE CASES

1. **Pipe in TOON values** — Fixed: `|` → `¦` (broken bar) in commit 3956e22
2. **tree-sitter fallback** — Some large TS files trigger `Invalid argument`, regex fallback handles them
3. **Memory concurrency** — No file locking. Safe for single-user, not for team/multi-session
4. **RSS memory** — 820MB RSS after indexing 6K files. Heap is only 46MB — Node.js behavior
