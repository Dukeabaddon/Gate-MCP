# Gate MCP — agent harness (proof-based loops)

**Audience:** Cursor/Codex agent working **in this repo** with an **orchestrator** parent.  
**Rule:** Do not claim “done” until **commands below pass** or you document a **blocked** external dependency with evidence.

---

## 1. North-star goal

Make Gate MCP **measurably** reduce agent context cost **without** fake savings, broken cache partitions, or silent SQLite fallback — while staying honest in `gate_session_stats` (`measurement_scope`).

Success = green `npm run qa` (or agreed subset) + `gatemcp doctor --strict` + MCP acceptance + reproducible demo (React `ReactFiberWorkLoop.js` compress vs full read).

---

## 2. Orchestrator responsibilities (parent chat)

The **orchestrator** does **not** implement large diffs inline when 3+ files or failing QA.

| Step | Action |
|------|--------|
| Plan | Write `DELEGATE-PLAN.md` at repo root with tasks, owners, acceptance commands |
| Spawn | `delegate-implementer` (Composer 2.5 standard) for code; `delegate-explore` for read-only; `delegate-research` (Grok) max 1× per goal |
| Brief | Every subagent prompt includes: repo path, files in scope, **do not touch**, AC command output required |
| Verify | Reject worker if no command output, no diff, or “done” without test line |
| Integrate | Parent runs `npm test` / `test:mcp` after each merge slice |
| Stop | Only when AC green or user accepts **blocked** with issue link |

**Forbidden:** marking todos complete before tests run; inventing `savingsPercent`; shipping with `expanded: true` reported as win.

---

## 3. Worker proof requirements

Every implementation task must return:

```markdown
## Result
- Status: pass | fail | blocked
- Changed files: …
- Commands: (copy/paste exit code + last 20 lines)
- Tests: which script proved it
- Blockers: …
```

### Minimum proof ladder (run in order)

| Level | Command | When |
|-------|---------|------|
| L1 | `npm run build` | After any TS change |
| L2 | `npm run test:unit` | Default per PR slice |
| L3 | `npm test` | Before “feature complete” (includes qa-multi-repo + adversarial) |
| L4 | `npm run test:mcp` | Catalog mode / `gate_invoke` / tool list changes |
| L5 | `npm run test:doctor` | Cache / `GATE_PROJECT_ROOT` / SQLite changes |
| L6 | `npm run qa` | Release candidate only |

Use **Jest/Playwright/Selenium** only if you add them to this repo; today proof is **Node regression scripts** in `scripts/` and `dist/*-regression.js` — prefer extending those over new frameworks unless orchestrator approves.

---

## 4. QA status (v0.5.7)

**2026-10-12:** `npm test` → **49 passed, 0 failed**; `doctor --strict` → PASS.

Fixed (test/QA only — production already canonicalized roots):

- `src/test.ts` — Test 34 temp `GATE_PROJECT_ROOT` for AlgoTrading SMC; Test 42 canonical partition paths.
- `scripts/qa-multi-repo-proof.mjs` — `cachePartition` compared via `fs.realpathSync.native`.

Committed on branch `fix/qa-057` (based on `origin/main` 8547e2e, which already contains v0.5.7). Re-verified on that base: build 0, `npm test` 0 (49/0, multi-repo QA pass, adversarial `failedCount: 0`), `doctor --strict` PASS. Not published — npm still `0.5.7`. See `DELEGATE-PLAN.md`.

---

## 5. Session scan (what users actually hit)

From Cursor transcripts under `Users-macbookair-Documents-Visual-Studio-Code-MCP-gate-mcp`:

| Session theme | User need | Harness task |
|---------------|-----------|--------------|
| `90aaa126` (large) | Ship repo, graphify, multi-language, demo, docs | Keep `qa` green; demo script in README |
| `7a7b7a61`, `9278e3be` | **Before/after** token demo on React work loop | Automate `scripts/` compare full read vs `gate_compress_file signature` |
| `79c7d291` | GitHub badges, license, demo prompts | Docs only — no fake metrics |
| **elite-kommo-bots** (this chat) | `Savings: n/a`, `persistentCache: false`, skipped stack | Docs: footer semantics; example `mcp.json` env block |

Cross-project usage (not Gate repo): AlgoTrading, n8n-voice-memo, Drawbridge — use **per-repo** `GATE_PROJECT_ROOT`, not `~`.

---

## 6. Dogfood config (Aaron’s machine)

After upgrade, **restart Cursor** so MCP reloads.

Recommended `mcpServers.gatemcp.env` (per machine):

```json
{
  "GATE_PROJECT_ROOT": "/Users/macbookair/Documents/Visual Studio Code/MCP/gate-mcp",
  "GATE_CACHE_DB": "/Users/macbookair/Documents/Visual Studio Code/MCP/gate-mcp/.gate-mcp/cache.db"
}
```

Switch `GATE_PROJECT_ROOT` when opening **elite-kommo-bots** or **elite-translations-tracker** (or pass `projectRoot` on every `gate_init`).

**v0.5.7:** `toolMode=catalog` — long-tail tools via `gate_invoke`; acceptance in `npm run test:mcp`.

**Cursor Node ABI:** If MCP errors with `NODE_MODULE_VERSION 127` vs `137`, pin MCP to the same Node that built `better-sqlite3` (e.g. nvm `node` + `dist/main.js` in `mcp.json`, not bare `gatemcp` under Cursor’s bundled Node). Restart Cursor after upgrade.

---

## 7. Agent loop template (paste into orchestrator chat)

```text
Goal: <one measurable outcome>
Repo: /Users/macbookair/Documents/Visual Studio Code/MCP/gate-mcp
Done when: npm test exits 0 AND gatemcp doctor --strict passes
Plan: DELEGATE-PLAN.md
Workers: delegate-implementer only unless research blocked twice
After each worker: parent runs npm run test:unit
Do not commit unless user asks
```

---

## 8. What “no other way” means

Stop only if:

- Upstream dependency broken (npm, native SQLite) — show `doctor --json` failure
- User explicitly cancels
- Issue requires design decision — list options, default recommendation, **no code**

Otherwise: shrink scope, add test, loop.

---

## 9. Related docs

- `ARCHITECTURE.md` — compression pipeline
- `README.md` — install + changelog
- Cursor skill: `~/.cursor/skills/gatemcp-workflow/SKILL.md`
- Cursor skill: `~/.cursor/skills/delegate/SKILL.md`
