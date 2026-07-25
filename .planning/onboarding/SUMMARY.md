# GSD Onboarding Summary — Gate-MCP

**Date:** 2026-07-25
**Runtime:** Cursor (local install via `@opengsd/gsd-core`)
**Mode:** Brownfield

## What was installed

| Item | Location |
|------|----------|
| Upstream clone (reference) | `../gsd-core` (sibling under `qc-navigo-site`) |
| Project install | `Gate-MCP/.cursor/` — commands, skills, hooks, `gsd-core` |
| CLI | `Gate-MCP/.cursor/gsd-core/bin/gsd-tools.cjs` |
| Install command used | `npx @opengsd/gsd-core@latest --cursor --local --profile=full` (reinstalled after standard to get all 34 agents) |
| Health check | `gsd-tools validate health` → **healthy** (0 missing agents) |

Note: `.cursor/` is gitignored in Gate-MCP — GSD stays local to this machine unless you change ignore rules.

## Codebase map

Created under `.planning/codebase/`:

- `STACK.md`
- `ARCHITECTURE.md`
- `STRUCTURE.md`
- `CONVENTIONS.md`
- `TESTING.md`
- `INTEGRATIONS.md`
- `CONCERNS.md`

## Project artifacts

- `.planning/PROJECT.md`
- `.planning/REQUIREMENTS.md`
- `.planning/ROADMAP.md`
- `.planning/STATE.md`
- `.planning/config.json`

## Verification snapshot (Gate product)

Full local suite on 2026-07-25 ended **QA_EXIT:0**, including build, unit/multi-repo/adversarial, security, MCP acceptance + inspector (6 catalog tools), doctor (SQLite + tools_list), `check:release` aligned at **0.5.7**, `audit:prod` 0 vulnerabilities.

## How to talk to GSD Core next

Open Cursor with workspace root **`Gate-MCP`**, then use slash commands:

1. `/gsd-help` — command list
2. `/gsd-onboard` — re-check setup (should confirm complete)
3. `/gsd-discuss-phase 1` — decide ship/commit details for 0.5.7
4. `/gsd-plan-phase 1` — write phase plans
5. `/gsd-execute-phase 1` — implement
6. `/gsd-verify-work 1` — prove done
7. `/gsd-progress` — status anytime
8. `/gsd-map-codebase` — refresh map after big structural changes

Natural language also works if you say: “run GSD discuss phase 1” / “GSD plan phase 1” — the agent should follow the matching `.cursor/commands/gsd-*.md` workflow.

## Next recommended command

```text
/gsd-discuss-phase 1
```

Focus: commit/publish readiness for **0.5.7** only when you explicitly approve git/npm actions.
