# Requirements: Gate-MCP

**Defined:** 2026-07-25
**Core Value:** Trustworthy measured compression with safe project-root containment and lean tool schemas

## v1 Requirements

### Release coherence (0.5.7)

- [ ] **REL-01**: Working tree, `package.json`, `src/version.ts`, plugin pin, and README release status all say **0.5.7** with no RC/0.5.6 leftover checklist drift
- [ ] **REL-02**: `npm run check:release` passes after commit
- [ ] **REL-03**: `@gatemcp/cli@0.5.7` is published and installable (`npm view` / `npm exec`)
- [ ] **REL-04**: Cursor / plugin MCP config can pin `@gatemcp/cli@0.5.7` (or equivalent local dist) and doctor reports catalog tools + SQLite cache healthy

### Quality gates (must stay green)

- [x] **QA-01**: `npm run build` succeeds
- [x] **QA-02**: `npm test` (unit + multi-repo + adversarial) passes
- [x] **QA-03**: `npm run test:security` passes
- [x] **QA-04**: `npm run test:mcp` and `test:mcp-inspector` pass (catalog expects 6 tools)
- [x] **QA-05**: `npm run test:doctor` passes with SQLite + tools_list
- [x] **QA-06**: `npm run audit:prod` reports 0 moderate+ vulnerabilities

### Product invariants already in tree

- [x] **CAT-01**: Default catalog mode exposes help, init, compress, graph, session_stats, gate_invoke
- [x] **SQL-01**: Missing SQLite module **or** open/ABI failure fails closed unless `GATE_ALLOW_MEMORY_CACHE=1`
- [x] **MAP-01**: Symbol map + HTML export write under `.gate-mcp/` with path safety

## v2 Requirements

### Ecosystem

- **ECO-01**: Optional live graphify MCP bridge (complementary to Gate symbol graph)
- **ECO-02**: Official TOON / Code Mode packaging experiments

## Out of Scope

| Feature | Reason |
|---------|--------|
| Caveman / caveman-shrink | Explicit product decision — out of scope |
| Rebuild Gate as a new product | Brownfield: ship what exists |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| REL-01 | Phase 1 | Pending |
| REL-02 | Phase 1 | Pending |
| REL-03 | Phase 1 | Pending |
| REL-04 | Phase 1 | Pending |
| QA-01..QA-06 | Phase 1 | Complete (local 2026-07-25) |
| CAT-01, SQL-01, MAP-01 | Phase 1 | Complete (in tree) |
| ECO-01, ECO-02 | — | Deferred (v2) |

**Coverage:**
- v1 requirements: 13 total (7 release/product + 6 QA)
- Mapped to phases: all release/product → Phase 1
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-25*
*Last updated: 2026-07-25 after GSD brownfield init*
