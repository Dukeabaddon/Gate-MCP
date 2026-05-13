# Gate-MCP: Experiment Lab & Research Log
## FAIROS Protocol — Ongoing Research Tracker

---

## Completed Experiments

### Experiment #1 — Scale Test ✅ PASSED
**Date:** 2026-05-13 | **Commit:** `b3ca3cf`

**Hypothesis:** In-memory graph survives enterprise-scale monorepos.

| Repo | Files | Build | Nodes | Memory | Search | BFS |
|---|---|---|---|---|---|---|
| Gate-MCP | 14 TS | 71ms | 162 | 3MB | 1ms | 0ms |
| Express.js | 141 JS | 318ms | 227 | ~0MB | 1ms | 0ms |
| VSCode | 6,115 TS | 3,205ms | 12,971 | 25MB | 8ms | 18ms |

**Verdict:** All criteria met. Build <5s ✅ | Queries <100ms ✅ | No OOM ✅

---

### Experiment #2 — Semantic Quality ✅ PASSED
**Date:** 2026-05-13 | **Commit:** `b3ca3cf`

**Hypothesis:** AST signatures retain ≥90% of API surface.

**Result:** 21/21 exported functions (100%), 49/49 imports (100%).

Average compression: 78.4% while retaining complete API surface.

**Caveat:** Structural validation only. LLM-in-the-loop test still needed.

---

### Experiment #3 — TOON Consumption ✅ PASSED
**Date:** 2026-05-13 | **Commit:** `b3ca3cf`

**Hypothesis:** TOON data can be parsed back with ≥95% fidelity.

**Result:** 17/17 fields (100%), 15/15 values (100%), 6/6 test cases.

**Edge case discovered:** Pipe characters in values cause column collision.
**Fix applied:** `|` → `¦` in commit `3956e22`.

---

## Pending Experiments

### Experiment #4 — LLM-in-the-Loop (P0)
**Status:** 🟡 Waiting for API key

**Design:**
1. Take 5 source files from Gate-MCP
2. Compress each via `gate_compress_file` (signature mode)
3. Feed compressed signatures to Claude API with prompt:
   "Using only these signatures, write a function that calls handleCompressFile with correct parameters"
4. Measure: does generated code compile? Does it use correct types?

**Success criterion:** ≥80% of generated functions compile correctly.

### Experiment #5 — Cross-IDE Validation (P1)
**Status:** 🔴 Not started

Test gate-mcp as configured MCP server in:
- [ ] Cursor
- [ ] Windsurf
- [ ] Claude Code
- [ ] Antigravity
- [ ] VS Code Copilot

Verify: tools appear, queries work, savings reported.

### Experiment #6 — mcp-compressor Integration Study (P1)
**Status:** 🔴 Not started

Install `@nicepkg/mcp-compressor`, measure:
- How many tokens do 10 connected MCP servers cost?
- Does proxy-level compression compose with our application-level?
- Can we learn from their lazy-loading implementation?

---

## Frontier Research Tracking

### Papers & Tools Monitored

| Source | Innovation | Relevance to Gate-MCP |
|---|---|---|
| CPC (Workday, AAAI 2025) | Sentence-level compression | Could compress code comments |
| LLMLingua-2 (Microsoft) | ML prose compression | Different domain (prose vs code) |
| Graphify (32K★) | Leiden clustering + non-code ingestion | We should add clustering |
| Caveman (59.5K★) | Output compression skill | Complementary (L4) |
| mcp-compressor (Atlassian) | Transparent schema proxy | Could compose with our L0 |
| McPick | Server toggling | Orthogonal — reduces server count |
| Cavemem | SQLite/FTS5 memory | Could replace our JSON memory |

### Architectural Insights from Graphify (Source Study)

Key findings from studying `vendor/graphify/`:

1. **extract.py is 5,958 lines.** 25+ languages, each with custom import handlers. This is the main engineering cost.
2. **Confidence labels** (EXTRACTED / INFERRED / AMBIGUOUS) — we should add this.
3. **Token budgeting** — Graphify's `_subgraph_to_text` truncates at a char budget (3 chars/token). Smart.
4. **Security layer** (`security.py`) — label sanitization, URL validation. We need this.
5. **Blank stdin filtering** — Graphify has a workaround for MCP clients sending blank lines. We might need this too.
6. **Scored search** — Three-tier scoring (exact > prefix > substring) with bonus weights. Our search is simpler.
