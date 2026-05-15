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
4. **Security layer** (`security.py`) — label sanitization, URL validation. **Adopted v0.3.0 in `pathGuard.ts`**.
5. **Blank stdin filtering** — Graphify has a workaround for MCP clients sending blank lines. We might need this too.
6. **Scored search** — Three-tier scoring (exact > prefix > substring) with bonus weights. Our search is simpler.

---

## v0.3.0 FAIROS Review — Bug Verification + Fix Audit (2026-05-15)

Adversarial review of `gate-mcp-full-context.md` section 7 claims, per FAIROS Rule 1 (challenge before execute) + Rule 2 (label confidence).

| Doc Claim | Verdict | Real Severity | Fix Applied |
|---|---|---|---|
| P0 CRASH — `discoverFiles()` returns undefined for >1000 files | **FALSE** (returns `string[]`). Real bug: silent 1000-file cap | Medium | Made cap configurable via `GATE_MAX_FILES` (default 5000, hard cap 50000), logs warning on truncation |
| P0 SECURITY — path traversal | **TRUE** — accepted any absolute path with zero boundary check | Medium (local trust model) | New `lib/pathGuard.ts` with `safeResolve()` + boundary enforcement + sensitive-pattern blocklist |
| P1 STALE — graph cache | **TRUE** — keyed only on `cachedProjectRoot`, no mtime/hash check | Medium | Cache now keyed by manifest hash (path + mtime + size SHA-256). Modified files trigger auto-rebuild |
| P1 LEAK — OCR worker | **TRUE** — `terminateOcr()` existed but no SIGINT handler | Low-Medium | `main.ts` registers SIGINT/SIGTERM/beforeExit handlers calling `gracefulShutdown()` |

**Secondary finding (Verified):** `.tsx` files routed to `tree-sitter-typescript.typescript` grammar instead of `.tsx` grammar — caused partial parse failures on JSX syntax. Fixed by adding `tsx` as separate `SupportedLanguage` variant routed to the correct grammar.

**Tertiary finding (Verified):** npm name `gate-mcp` was claimed by Gate.io's crypto-trading MCP server on 2026-04-17. Renamed package to `gatemcp` in v0.3.0.

## Multi-Language Expansion — v0.3.0

Decision matrix based on TIOBE (Feb–Mar 2026) + GitHub Octoverse (Aug 2025) + Stack Overflow Dev Survey (2025).

| Tier 1 — Native AST | Why | Parser version |
|---|---|---|
| Java | TIOBE #4 (8.1%), enterprise dominant | `tree-sitter-java@0.23.5` |
| C# | TIOBE #5 (6.8%), Unity, .NET | `tree-sitter-c-sharp@0.23.5` |
| C++ | TIOBE #3 (8.6%) | `tree-sitter-cpp@0.23.4` |
| Go | Cloud-native, growing | `tree-sitter-go@0.25` |
| Rust | SO 2025 #1 admired (72%) | `tree-sitter-rust@0.24` |
| HTML | SO 2025 #2 used (62%) | `tree-sitter-html@0.23.2` |
| CSS | Web stack staple | `tree-sitter-css@0.25` |
| JSON | Configs everywhere | `tree-sitter-json@0.24.8` |

All Tier 1 parsers are `optionalDependencies` — install failures (native module compile errors on Windows/M1) degrade gracefully to regex extraction. Server startup never blocked.

| Tier 2 — Regex fallback (deferred to v0.4 native) | Reason for deferral |
|---|---|
| SQL, PHP, Ruby, Kotlin, Swift, Scala, Vue, Svelte, YAML, Bash, Markdown | Regex extraction works; native parsers add weight without proportional value yet |

**Not supported:**
- VB.NET — no maintained tree-sitter parser. Microsoft pivoted to C# years ago. Hypothesis: <1% of AI-coding-assistant workloads.
- Dart (Flutter) — no stable parser. Community version flaky on M1/Windows.

## Experiment #4 Update (LLM-in-the-loop) — Pending

Original status: 🟡 waiting for API key. Still pending. Now the more interesting variant: test compressed signatures across **all 12 native languages**, not just TypeScript. Multi-language semantic-fidelity benchmark = stronger empirical claim.

## Experiment #5 Update (Cross-IDE) — IDE configs ready

v0.3.0 wired absolute paths into all 5 IDE config files: `.cursor/mcp.json`, `.windsurf/mcp_config.json`, `.claude/mcp.json`, `.antigravity/mcp.json`, `.vscode/mcp.json`. Ready for end-to-end IDE-level validation. Per-IDE smoke test sequence:
1. Open the IDE
2. Verify `gatemcp` tools appear in MCP panel
3. Call `gate_compress_file` on `src/main.ts`
4. Confirm response includes `savingsPercent > 0`
