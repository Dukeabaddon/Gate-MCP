# Roadmap: Gate-MCP

## Overview

Brownfield track: codebase is mapped and 0.5.7 behavior is locally QA-green. Phase 1 ships a coherent 0.5.7 release (docs/pins/publish). Later phases pick up deferred ecosystem work only after publish.

## Phases

- [ ] **Phase 1: Stabilize & ship 0.5.7** - Align docs/pins, commit, publish, verify consumer install
- [ ] **Phase 2: Post-ship hygiene** - Refresh GSD map if needed; optional graphify bridge spike (v2)

## Phase Details

### Phase 1: Stabilize & ship 0.5.7
**Goal**: One coherent published 0.5.7 with green gates and matching consumer pins
**Depends on**: Nothing (first phase)
**Requirements**: REL-01, REL-02, REL-03, REL-04 (QA-01..06 already green locally)
**Success Criteria** (what must be TRUE):
  1. README / version / plugin pin all describe published 0.5.7 with no skew
  2. `check:release` and the QA suite used for ship still pass on the release commit
  3. `npm view @gatemcp/cli version` returns `0.5.7` after publish
  4. Doctor against the published (or pinned) build shows catalog tools + SQLite cache
**Plans**: TBD (discuss → plan before execute)

Plans:
- [ ] 01-01: Align README release status and any leftover 0.5.6 RC wording
- [ ] 01-02: Commit 0.5.7 working tree (when user requests)
- [ ] 01-03: Publish + verify install / MCP pin (when user requests)

### Phase 2: Post-ship hygiene
**Goal**: Keep planning truth current; optionally spike graphify bridge without blocking ops
**Depends on**: Phase 1
**Requirements**: ECO-01 (optional)
**Success Criteria** (what must be TRUE):
  1. `.planning/codebase/` still matches post-release tree or is remapped
  2. Any graphify spike is documented as opt-in, not a Gate dependency
**Plans**: TBD

Plans:
- [ ] 02-01: Remap codebase if structure drifted after ship
- [ ] 02-02: Optional graphify bridge research spike

## Progress

**Execution Order:**
1 → 2

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Stabilize & ship 0.5.7 | 0/3 | Not started | - |
| 2. Post-ship hygiene | 0/2 | Not started | - |
