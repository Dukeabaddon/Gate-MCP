# Codebase Concerns — Gate-MCP

Evidence-backed risk map for the current tree. Snapshot: **2026-07-25**.

Branch: `fix/qa-055-compress-projectroot` @ `ae14c13` (+ large uncommitted working tree).

---

## 1. Version skew: uncommitted 0.5.7 vs HEAD 0.5.6 vs npm 0.5.5

**Severity:** High (release / consumer confusion)

| Layer | Version | Evidence |
|-------|---------|----------|
| Working tree | **0.5.7** | `package.json`, `src/version.ts`, `plugins/gatemcp/.mcp.json` (`@gatemcp/cli@0.5.7`), built `dist/version.js` |
| Last commit (HEAD) | **0.5.6** | `git show HEAD:package.json` / `HEAD:src/version.ts`; commit `be77a2e release: harden Gate MCP v0.5.6` |
| npm registry | **0.5.5** (latest) | `npm view @gatemcp/cli version` → `0.5.5`; published set: `0.4.0, 0.5.0, 0.5.3, 0.5.5` — **no 0.5.6 or 0.5.7** |
| Git tags | through `v0.5.5` | `git tag -l 'v0.5*'` — no `v0.5.6` / `v0.5.7` |

**Risks**

- Plugin pin in the working tree already points at `@gatemcp/cli@0.5.7`, which **does not exist on npm** — marketplace / `npm exec --package=@gatemcp/cli@0.5.7` installs will fail or resolve incorrectly until publish.
- README **Release status** still describes a **v0.5.6 RC** and an unchecked “Publish `@gatemcp/cli@0.5.6`” item, while the tree has already bumped past that to 0.5.7 without commit or publish.
- Operators comparing “docs say 0.5.6” vs “npm says 0.5.5” vs “local dist says 0.5.7” will mis-debug doctor / catalog / SQLite behavior.

**Mitigation (when releasing):** commit → tag → publish one coherent version → align plugin pin + README checklist in the same change; do not leave intermediate pins on unpublished versions.

---

## 2. Cursor / local MCP may still run published 0.5.5 (or stale pins)

**Severity:** High (runtime ≠ source)

- Checked-in README still states the plugin pins **`@gatemcp/cli@0.5.5`** (lines ~321–322, ~338) and that doctor is absent from that publish.
- HEAD plugin pin was `@gatemcp/cli@0.5.6` (also unpublished); WT pin is `@gatemcp/cli@0.5.7` (also unpublished).
- This machine’s Cursor user MCP (`~/.cursor/mcp.json`) currently runs **local** `Gate-MCP/dist/main.js` (not an npm pin). That avoids the registry lag **only if** `dist/` is rebuilt after source edits; other workspaces / teammates following README/`npx` still get **0.5.5**.

**Risk:** “Fixed in tree” bugs (catalog mode, required SQLite, `projectRoot`, `gate_invoke`) appear fixed in local Cursor but remain broken for anyone on the published package until pin + publish land together.

---

## 3. Catalog-mode test harness traps

**Severity:** Medium–High (false greens / false reds)

Product default is `GATE_TOOL_MODE=catalog` (`src/lib/toolMode.ts`, `ARCHITECTURE.md`). Long-tail tools are reachable only via `gate_invoke`.

| Harness | Mode forced | Trap |
|---------|-------------|------|
| `scripts/test-mcp-acceptance.mjs` | `catalog` | Correct product surface; asserts `gate_invoke` present, `gate_memory` hidden, list ≤ 8 |
| `scripts/test-mcp-inspector.mjs` | `catalog` | Same; must not list `gate_dedup_context` |
| `src/doctor.ts` | **forces `catalog`** even if parent shell exported `full` | Intentional — but a doctor-green result does **not** prove full-mode registration |
| `scripts/qa-multi-repo-proof.mjs` | `full` (“Schema/path probes need long-tail tools listed”) | Passes by calling tools **directly**; does **not** exercise `gate_invoke` dispatch path |
| `scripts/qa-adversarial-audit.mjs` | `full` (“Direct tool calls for path-guard…”) | Path-guard coverage in full mode ≠ catalog+invoke path |

**Risks**

1. **False confidence:** `npm test` / QA can pass while catalog clients cannot reach a tool because harnesses used `full` and skipped `gate_invoke`.
2. **Inherited env poison:** any script that spreads `...process.env` without overriding `GATE_TOOL_MODE` inherits a developer’s `full` export and asserts the wrong `tools/list` (doctor already documents this; not all scripts do).
3. **Dual surface drift:** adding a tool requires catalog reachability (`gate_invoke` allowlist) **and** full registration — easy to update only one path.

**Mitigation:** keep at least one MCP acceptance path that calls a long-tail tool **only** through `gate_invoke` under catalog; never treat full-mode QA as catalog proof.

---

## 4. Optional tree-sitter native ABI / compile failures

**Severity:** Medium (silent quality drop, not crash)

Documented in README + `src/lib/astParser.ts`:

- Native grammars are **optionalDependencies**; load failures → **regex fallback** (server stays up).
- **Vue / YAML:** loaders intentionally `return null` — NAN Language objects rejected by `tree-sitter@^0.21` (`Invalid language object`).
- **Svelte:** loader disabled — node-gyp / NAN failures on Node 22+.
- **Swift / other Tier-2:** peer pin to `tree-sitter ^0.21`; native install can still fail (e.g. paths with spaces breaking Makefile/`tree-sitter-cli`).
- README: “AST: tree-sitter where the host ABI loads; deterministic regex/direct-JSON fallback otherwise.”

**Risk:** compression / symbol fidelity quietly degrades on affected languages with no hard failure; agents may trust “AST signature” quality that is actually regex. Doctor checks core modules (`tree-sitter`, `tree-sitter-json`) but not every optional grammar ABI.

---

## 5. `GATE_ALLOW_MEMORY_CACHE` escape hatch

**Severity:** Medium (ops / durability)

- `ARCHITECTURE.md` L4 + SQLite policy: `better-sqlite3` is **required**; process start fails if the module cannot load **unless** `GATE_ALLOW_MEMORY_CACHE=1` (tests / emergency only).
- Implemented in `src/lib/sqliteRequired.ts` (`assertSqliteModuleOrExit`); warned in README / `gate_help`.
- Separate path: module loads but **DB open fails** → in-memory Map + `gate_init.cache.fallbackReason` (not the same as the env escape hatch).

**Risks**

- Setting `GATE_ALLOW_MEMORY_CACHE=1` in a long-lived IDE MCP config disables the fail-closed guarantee — dedup / memory look “fine” but are non-durable across restarts.
- Easy to leave enabled after local debugging; doctor `--strict` is the intended catch for non-persistent cache, but only if someone runs it.

---

## 6. P2 not done (TOON upstream, deeper graphify MCP)

**Severity:** Low–Medium (roadmap gap, not a regression)

From product boundary + prior planning (ARCHITECTURE non-goals + session roadmap):

| Item | Status | Notes |
|------|--------|-------|
| Official **TOON** upstream / SDK interop | **Not done (P2)** | Gate ships its own TOON-like cleaner (`gate_clean_response` / proxy); not wired to an upstream TOON SDK |
| **Deeper graphify MCP** live bridge | **Not done** | Bridge still reads `graphify-out/GRAPH_REPORT.md` (`graphifyBridge`); ARCHITECTURE: optional graphify MCP is partner space — Gate must not own a second corpus KG |
| Code Mode / caveman-shrink ecosystem wraps | **Not done / skipped** | Explicit non-goals in `ARCHITECTURE.md` |

**Risk:** pressure to “finish the roadmap” by cloning graphify or shipping Caveman inside Gate — would violate the documented product boundary.

---

## 7. `docs/` gitignore vs `ARCHITECTURE.md` at repo root

**Severity:** Low–Medium (docs publish / discoverability)

- `.gitignore` still ignores **`docs/`** and **`documentation/`** (“Internal docs — kept locally, not published”).
- `ARCHITECTURE.md` was moved to **repo root** and is currently **untracked** (`?? ARCHITECTURE.md`); `package.json` `files` already lists `"ARCHITECTURE.md"` for npm pack.
- Empty / absent `docs/` on disk; no longer an exception path like `!docs/ARCHITECTURE.md`.

**Risks**

- Until `ARCHITECTURE.md` is committed, clones and CI lack the architecture SSOT even though the package metadata expects to ship it.
- Contributors may recreate `docs/ARCHITECTURE.md` and have it silently gitignored.
- README / help references must stay on root `ARCHITECTURE.md`, not `docs/…`.

---

## 8. Working-tree volatility (supporting context)

Uncommitted / untracked surface for the 0.5.7 work (not exhaustive):

- Modified: `README.md`, `package.json`, `package-lock.json`, plugin pins, QA/MCP scripts, `main.ts`, `doctor.ts`, graph/help/init tools, `version.ts`, …
- Untracked: `ARCHITECTURE.md`, `src/lib/sqliteRequired.ts`, `src/lib/toolMode.ts`, `src/lib/symbolGraphViz.ts`, `src/tools/invoke.ts`, `.planning/`, `.local/`

Until commit + publish, all concerns above compound: local agents can run 0.5.7 features while public consumers remain on 0.5.5.

---

## Quick triage order

1. Decide release number (0.5.6 vs 0.5.7), commit, publish, retarget plugin + README pins together.
2. Confirm every Cursor / Codex MCP entry either uses local `dist/` **after build** or a **published** package pin — never an unpublished version string.
3. Add/keep catalog+`gate_invoke` coverage so full-mode QA cannot mask catalog breakage.
4. Treat `GATE_ALLOW_MEMORY_CACHE=1` as break-glass only; prefer fixing native `better-sqlite3` installs.
5. Keep graphify as report/MCP partner; leave TOON upstream and deeper graphify MCP as explicit P2.
6. Commit root `ARCHITECTURE.md`; do not put the SSOT back under ignored `docs/`.
