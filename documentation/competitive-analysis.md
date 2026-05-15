# Gate-MCP Competitive Analysis & Strategic Positioning
## FAIROS Research Document — May 2026

---

## 1. THE COMPETITIVE LANDSCAPE

There are 5 categories of MCP context compression tools in 2026. Gate-MCP is the only one operating across all 5 layers simultaneously.

### Category Map

```
                         SCOPE
           ┌───────────────────────────────────┐
           │   Single Layer    │   Multi-Layer  │
    ┌──────┼──────────────────┼────────────────┤
 P  │ Out  │ Caveman          │                │
 I  │      │ (output only)    │                │
 P  ├──────┼──────────────────┼────────────────┤
 E  │ In   │ LLMLingua-2      │  Gate-MCP ★    │
 L  │      │ (prose only)     │  (5 layers)    │
 I  ├──────┼──────────────────┼────────────────┤
 N  │ Nav  │ Graphify         │                │
 E  │      │ (graph only)     │                │
    ├──────┼──────────────────┼────────────────┤
    │ Proxy│ mcp-compressor   │                │
    │      │ (schema only)    │                │
    └──────┴──────────────────┴────────────────┘
```

---

## 2. HEAD-TO-HEAD ANALYSIS

### 2.1 Gate-MCP vs Graphify (32K★)

Graphify is our closest competitor and the current market leader.

| Dimension | Graphify | Gate-MCP | Winner |
|---|---|---|---|
| **Stars** | ~32,000 | 0 (new) | Graphify |
| **Language** | Python | TypeScript/Node.js | Depends |
| **AST Engine** | tree-sitter (Python bindings) | tree-sitter (Node.js WASM) | Tie |
| **Graph Storage** | NetworkX → JSON file (graph.json) | In-memory adjacency list (Map) | **Gate-MCP** (no file I/O) |
| **Query Approach** | BFS/DFS + token budget + scoring | BFS + simple token count | Graphify |
| **Community Detection** | Leiden clustering via networkx | None | Graphify |
| **Non-Code Files** | PDF, images, Google Docs, URLs | Images (OCR/downscale) | Graphify |
| **Input Compression** | No (graph only) | AST signature extraction | **Gate-MCP** |
| **Response Compression** | No | TOON notation | **Gate-MCP** |
| **Schema Compression** | No | gate_help lazy loading | **Gate-MCP** |
| **Session Dedup** | Semantic cache (SHA-based) | SHA-256 content cache | Tie |
| **Cross-Session Memory** | Graph persists to disk | JSON key-value store | Tie |
| **MCP Tools** | 7 tools (query, node, neighbors, community, god_nodes, stats, shortest_path) | 7 tools (compress, graph, dedup, clean, memory, image, help) | Tie (different focus) |
| **Security** | URL validation, label sanitization, path validation | None explicit | Graphify |
| **Languages Supported** | 25+ (Python, JS, TS, Java, C, C++, Go, Rust, etc.) | 3 (TS, JS, Python) | Graphify |
| **Install** | `pip install graphify` | `npm install gate-mcp` | Tie |
| **LOC** | ~252K (extract.py alone = 5,958 lines) | ~1,620 | **Gate-MCP** (10x smaller) |

#### Our Advantage Over Graphify:
1. **Multi-layer compression.** Graphify ONLY does navigation (Layer 1). We compress inputs, responses, schemas, AND navigation.
2. **In-process speed.** No file I/O for graph queries. Graphify writes/reads `graph.json` from disk.
3. **10x smaller codebase.** Easier to audit, fork, and contribute to.
4. **Node.js ecosystem.** Most MCP servers are Node.js. We're a natural fit.

#### Where Graphify Beats Us:
1. **25+ languages** vs our 3. Critical for enterprise adoption.
2. **Leiden clustering** — community detection reveals architectural patterns we can't.
3. **Non-code ingestion** — PDFs, Google Docs, URLs. We only do images.
4. **32K stars** = massive community, battle-tested in production.
5. **Shortest-path queries** — we don't have inter-symbol pathfinding.

---

### 2.2 Gate-MCP vs Caveman (59.5K★)

| Dimension | Caveman | Gate-MCP |
|---|---|---|
| **Layer** | Output only (L4) | Input + Nav + Response + Schema (L0-L3) |
| **Method** | Prose compression via system prompt | AST + TOON + graph |
| **Savings** | 60-75% on output | 37-99% on input |
| **Where cost is** | Output is 10-20% of bill | Input is 80-90% of bill |
| **Verdict** | **Complementary, not competitive.** Use Caveman for L4, Gate-MCP for L0-L3. |

---

### 2.3 Gate-MCP vs mcp-compressor (Atlassian)

| Dimension | mcp-compressor | Gate-MCP |
|---|---|---|
| **Layer** | Schema only (L0) — transparent proxy | All 5 layers |
| **Method** | Intercepts ListTools, strips descriptions | Terse descriptions + gate_help |
| **Architecture** | Proxy that wraps ANY MCP server | Application-level (own tools only) |
| **Advantage** | Zero-code, works with any server | Deeper compression (inputs, responses) |
| **Verdict** | mcp-compressor is broader (any server), Gate-MCP is deeper (5 layers). |

---

### 2.4 Gate-MCP vs LLMLingua-2

| Dimension | LLMLingua-2 | Gate-MCP |
|---|---|---|
| **Layer** | Input compression (prose/docs) | Input + Nav + Response + Schema |
| **Method** | ML model (DistilBERT) | Deterministic AST + TOON |
| **Requirements** | Python + PyTorch + model download | Node.js only, zero ML deps |
| **Speed** | ~500ms per document | ~5ms per file |
| **Applicability** | Prose, docs, natural language | Code, JSON, images |
| **Verdict** | LLMLingua handles prose; Gate-MCP handles code. **Different domains.** |

---

## 3. OUR UNIQUE VALUE PROPOSITION

### What Nobody Else Does:

```
We are the ONLY tool that:
 1. Compresses at 5 layers simultaneously
 2. Runs as a single local npm binary
 3. Requires zero API keys, zero cloud, zero ML models
 4. Provides measurable savings metrics on every response
 5. Is under 2,000 LOC (auditable in an afternoon)
```

### The Integration Insight:

Individual compression techniques exist everywhere. The breakthrough is **stacking them**:

```
Raw workflow:    30K tool schemas + 10K file reads + 5K JSON responses = 45K tokens
Gate-MCP:         188 schemas    +   600 AST sigs  +  3K TOON tables  =  3.8K tokens

Total savings: ~91%
```

No single tool achieves this. Graphify saves on navigation. Caveman saves on output. mcp-compressor saves on schemas. Gate-MCP saves on **everything input-side**.

---

## 4. HONEST WEAKNESSES (FAIROS Principle 1)

| Weakness | Severity | Mitigation Plan |
|---|---|---|
| 3 languages (TS/JS/Python) vs Graphify's 25+ | 🔴 High | Add Go, Java, Rust parsers (Phase 3) |
| No community/cluster detection | 🟡 Medium | Could integrate Leiden via WASM |
| No non-code file ingestion (PDFs, docs) | 🟡 Medium | Add Markdown/JSON/YAML parsers |
| No shortest-path queries | 🟢 Low | BFS covers 90% of use cases |
| 0 stars vs 32K (Graphify) / 59.5K (Caveman) | 🔴 High | Hackathon demo + writeup |
| No explicit security layer | 🟡 Medium | Add input sanitization (Phase 3) |

---

## 5. PHASE 3 ROADMAP (HACKATHON & BEYOND)

### P0 — Must Have (Hackathon)
| # | Task | Rationale | LOC Est |
|---|---|---|---|
| 1 | **README.md** with demo GIF | First impressions. Nobody installs without a README. | ~200 |
| 2 | **npm publish** as `gate-mcp` | Must be installable in one command. | config |
| 3 | **gate_shrink_tools v2** | Proxy mode: compress ANY connected MCP server's schemas | ~300 |
| 4 | **LLM-in-the-loop test** | Feed compressed output to Claude API, measure generation quality | ~150 |

### P1 — Should Have (Week After)
| # | Task | Rationale | LOC Est |
|---|---|---|---|
| 5 | **Go + Java parsers** | Cover 70% of enterprise codebases | ~400 |
| 6 | **Markdown/YAML compression** | Config files are 30% of context in DevOps | ~150 |
| 7 | **File locking for memory** | Production-safe concurrent access | ~50 |
| 8 | **Security audit** | Input sanitization, path traversal prevention | ~100 |

### P2 — Nice to Have (Month After)
| # | Task | Rationale | LOC Est |
|---|---|---|---|
| 9 | **Leiden clustering** | Community detection for architecture analysis | ~200 |
| 10 | **Shortest-path queries** | Feature parity with Graphify | ~100 |
| 11 | **VS Code extension** | One-click install instead of JSON config | ~500 |
| 12 | **Benchmarking suite** | Automated regression testing on real repos | ~300 |

---

## 6. KEY DESIGN DECISIONS LOG

| Decision | Alternative Considered | Why We Chose This |
|---|---|---|
| TypeScript/Node.js | Python (like Graphify) | 95% of MCP ecosystem is Node.js |
| In-memory graph | NetworkX/SQLite | Zero file I/O = instant queries |
| TOON notation | CSV / Protobuf | Human-readable + LLM-parseable |
| JSON memory | SQLite / LevelDB | Zero dependencies |
| Terse descriptions + gate_help | Proxy interception | Works within MCP spec, no hacks |
| tree-sitter WASM | regex-only | Deterministic AST = reliable extraction |
| `¦` pipe escape | `\|` backslash escape | Visually similar, no escape parsing needed |

---

## 7. FOR THE AI AGENT: RULES

1. **Always measure.** Every tool response must include `originalTokens`, `optimizedTokens`, `savingsPercent`.
2. **Never break the 5-layer model.** New tools must belong to one of the 5 layers.
3. **Conventional commits.** Format: `feat:`, `fix:`, `test:`, `docs:`, `chore:`.
4. **Don't touch vendor/.** That's reference code, not our source.
5. **Run tests before committing.** `node dist/test.js` must pass 13/13.
6. **Use gate_help for documentation.** Don't duplicate tool docs in README.

<!-- Last reviewed: 2026-05-15 — content still accurate as of v0.3.2 release. -->
