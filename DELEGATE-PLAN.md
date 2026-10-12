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
