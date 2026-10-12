# DELEGATE-PLAN — v0.5.7 QA green

**Repo:** `/Users/macbookair/Documents/Visual Studio Code/MCP/gate-mcp`  
**Done when:** `npm test` exit 0 AND `node dist/main.js doctor --strict` pass  
**No commit** unless user asks.

## Repro (2026-10-12)

| Command | Result |
|---------|--------|
| `npm test` | 47 passed, 2 failed |

### Failures

1. **Test 34 — AlgoTrading SMC** — `handleGraphQuery` with `projectRoot: algoSmc` while `GATE_PROJECT_ROOT` = gate-mcp → boundary error.
2. **Test 42 — cachePartition** — `mkdtemp` `/var/...` vs canonical `/private/var/...`.

## Tasks

| ID | Owner | Scope | Fix | Status |
|----|-------|-------|-----|--------|
| T1 | implementer (`b8ab98b6`) | `src/test.ts` | Temp set `GATE_PROJECT_ROOT=algoSmc` for Test 34, restore in `finally` | [x] verified |
| T2 | implementer (`b8ab98b6`) | `src/test.ts`, `scripts/qa-multi-repo-proof.mjs` | Compare `cachePartition` to `canonicalizePath` / `realpathSync.native`; qa assert added as regression guard | [x] verified |
| T3 | parent (orchestrator) | — | `npm run build`, `npm run test:unit`, `npm test`, `doctor --strict` | [x] verified |

## Verification (orchestrator, 2026-10-12 08:12, Node 22.21.1)

| Command | Exit | Result |
|---------|------|--------|
| `npm run build` | 0 | tsc clean |
| `npm run test:unit` | 0 | 49 passed, 0 failed |
| `npm test` | 0 | unit 49/0 + qa-multi-repo pass + adversarial `failedCount: 0` |
| `node dist/main.js doctor --strict` | 0 | 10/10 PASS, `ok: true` |

Re-verified after moving fixes onto branch `fix/qa-057` from `origin/main` (8547e2e): build 0, `npm test` 0, same counts.

Review notes: Test 34 fix is test-side (product boundary refusal is intended security behavior). Test 34 only runs on machines with the AlgoTrading SMC checkout; skips elsewhere.

## Acceptance

```bash
npm run build
npm run test:unit
npm test
node dist/main.js doctor --strict
```

## Out of scope

- graphify node-count drift warnings
- EPIPE on MCP stdio after test suite (non-failing noise)

---

# Next — end-user docs (done) + React demo (plan only)

Constraints: Gate stays standalone; graphify is a separate tool, no bundling.
Ask the user before any graphify integration or caveman-in-code change.

## D1 — README end-user docs [x]

- `What Gate compresses — and what it does not` (tool results only; not prompts, built-in Read, or model output; meaning of `Savings: n/a`).
- `Reading gate_session_stats` — persistent-cache fields vs process-wide fields, `measurement_scope`, `billingScope`, honest example.
- `Pin Node in mcp.json` — absolute `node` + `dist/main.js` paths; `NODE_MODULE_VERSION` symptom; verify with `doctor --strict`.
- Known limitations: code generation, native SQLite rows.

## P1 — React demo script: full read vs compress (PLAN ONLY — do not build until user says)

Goal: reproducible, honest before/after numbers for marketing, from one command.

| Step | Detail |
|------|--------|
| Fixture | Pin a public React repo at a fixed commit (e.g. a mid-size Vite + React app), cloned to a temp dir — not vendored |
| Task | Fixed "work loop": 8–12 files a real agent touches for one feature (component, hook, context, API client, test) |
| Baseline | Raw file bytes + BPE tokens (same counter as `tokenCounter.ts`) for each file |
| Gate | Spawn `dist/main.js` over MCP stdio; call `gate_compress_file` `signature` per file, then a second pass to show dedup hits; finish with `gate_session_stats` |
| Output | `demo/react-demo-result.json` + Markdown table: file, raw tokens, Gate tokens, %, `expanded` flag |
| Honesty | Label `billingScope: tool_payload_only`; include files where Gate expands or saves ~0; show that edits still need a `full` read |

Files: `scripts/demo-react-compare.mjs` (new), `package.json` script `demo:react`, README "Benchmarks" link.
Acceptance: deterministic numbers on two runs; no network after clone; runs on Node 20 and 22.
Risks: picking a repo that flatters Gate — choose before seeing numbers; signature-only views are not enough to edit code, so the demo must say so.
