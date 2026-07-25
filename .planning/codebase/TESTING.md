# Testing Patterns

**Analysis Date:** 2026-07-25

## Test Framework

**Runner:**
- No Jest / Vitest / Mocha — custom Node ESM suites
- TypeScript suites compile via `tsc` then run as `node dist/*.js`
- Ad-hoc / transport QA: `scripts/*.mjs` (native ESM)

**Assertion Library:**
- `node:assert/strict` in regression and `.mjs` scripts
- Manual pass/fail counters + `console.error` in `src/test.ts`

**Run Commands:**
```bash
npm run build                 # tsc → dist/ (required before most suites)
npm run test:unit             # node dist/test.js
npm test                      # unit + multi-repo proof + adversarial audit
npm run test:security         # node dist/security-regression.js
npm run test:storage          # node dist/storage-regression.js
npm run test:mcp              # scripts/test-mcp-acceptance.mjs
npm run test:mcp-inspector    # scripts/test-mcp-inspector.mjs
npm run test:doctor           # gatemcp doctor --strict --json
npm run test:production       # scripts/production-regression.mjs
npm run test:qa-multirepo     # scripts/qa-multi-repo-proof.mjs
npm run test:qa-adversarial   # scripts/qa-adversarial-audit.mjs
npm run stress                # node dist/stress-test.js
npm run qa                    # full release gate (build → tests → checks → audit)
```

**Watch / coverage:** Not detected — no coverage tooling or watch test script

## Test File Organization

**Location:**
- Primary unit/integration suite: `src/test.ts` → `dist/test.js`
- Focused TS regressions next to product code: `src/security-regression.ts`, `src/storage-regression.ts`, `src/stress-test.ts`
- Transport / packaging / QA: `scripts/*.mjs`
- Fixtures: `test-fixtures/` (e.g. `test-fixtures/multi-repo-web/`)

**Naming:**
- TS: descriptive (`test.ts`, `*-regression.ts`, `stress-test.ts`)
- Scripts: `test-*.mjs`, `qa-*.mjs`, `*-regression.mjs`, `check-*.mjs`

**Structure:**
```
src/test.ts                     # broad handler suite (~47 numbered cases)
src/security-regression.ts      # path boundary + proxy isolation
src/storage-regression.ts       # storage persistence regressions
src/stress-test.ts              # load / stress
scripts/test-mcp-acceptance.mjs # stdio JSON-RPC acceptance (catalog)
scripts/test-mcp-inspector.mjs  # official Inspector CLI tools/list
scripts/qa-multi-repo-proof.mjs # multi-repo compress/cache e2e (full)
scripts/qa-adversarial-audit.mjs# cwd / projectRoot adversarial cases (full)
scripts/production-regression.mjs
scripts/test-packed-package.mjs
scripts/test-plugin-command.mjs
scripts/check-release-consistency.mjs
test-fixtures/multi-repo-web/   # shared web fixture tree
```

## Script Matrix (`package.json`)

| Script | What it runs | Typical `GATE_TOOL_MODE` |
|--------|--------------|---------------------------|
| `test:unit` | `dist/test.js` | process env (suite imports handlers directly; Test 45 exercises catalog/full helpers) |
| `test` | unit + `qa-multi-repo-proof` + `qa-adversarial-audit` | multirepo/adversarial force **`full`** |
| `test:security` | `dist/security-regression.js` | N/A (direct `pathGuard` / proxy APIs) |
| `test:mcp` | `test-mcp-acceptance.mjs` | **`catalog`** (locked) |
| `test:mcp-inspector` | `test-mcp-inspector.mjs` | **`catalog`** (locked) |
| `test:doctor` | `dist/main.js doctor --strict --json` | doctor child forces **`catalog`** |
| `test:qa-multirepo` | `qa-multi-repo-proof.mjs` | **`full`** |
| `test:qa-adversarial` | `qa-adversarial-audit.mjs` | **`full`** |
| `qa` | build + `test` + stress + production + security + storage + mcp + inspector + doctor + release/deps/package + `audit:prod` | mixed per child |

**CI** (`.github/workflows/ci.yml`):
- Matrix job: `build`, `test:production`, `test:security`, `test:storage`, `test:doctor`
- Acceptance job (Node 26): full `npm run qa` + `test:plugin` + `npm pack --dry-run`

**Publish gate:** `prepublishOnly` → `clean` + `qa`

## Test Structure

**Suite Organization (`src/test.ts`):**
```typescript
async function runTests(): Promise<void> {
  let passed = 0;
  let failed = 0;

  // ── Test N: gate_* (scenario) ──
  console.error(`\n${INFO} Test N: …`);
  try {
    const result = await handleCompressFile({ filePath, depth: "signature" });
    // assert invariants; throw on failure
    passed++;
  } catch (err) {
    console.error(`  ${FAIL} ${err}`);
    failed++;
  }

  // cleanup OCR / cache / memory module state
  await terminateOcr();
  closeCacheDb();
  _resetMemoryDbForTests();
  if (failed > 0) process.exit(1);
}
```

**Patterns:**
- Numbered scenarios with emoji markers (`PASS` / `FAIL` / `INFO`) on stderr
- Prefer calling **handlers** (`handle*`) for unit breadth; spawn `dist/main.js` for transport
- Temp dirs via `fs.mkdtempSync(path.join(os.tmpdir(), "gate-…"))`; always restore env + `rmSync` in `finally`
- Reset shared module state with `_reset*ForTests` helpers after mutating cache/memory/session metrics

**Regression list pattern (`src/security-regression.ts`):**
```typescript
const tests: TestCase[] = [
  {
    name: "symlink file escape",
    run: () => {
      expectRejected(() => safeResolveExistingFile(fileLink), /outside project boundary/);
    },
  },
];
for (const test of tests) {
  await test.run();
  process.stderr.write(`PASS ${test.name}\n`);
}
```

## `GATE_TOOL_MODE`: catalog vs full in tests

**Semantics** (`src/lib/toolMode.ts`):
- **`catalog` (default):** only `CATALOG_CORE_TOOLS` appear in `tools/list`; long-tail via `gate_invoke`
- **`full`:** every Gate tool registered; **`gate_invoke` omitted** (redundant)

**When tests must use `catalog`:**
- Product-surface / schema-budget locks — MCP acceptance, Inspector, doctor child env
- Assert `gate_invoke` present, long-tail tools (`gate_memory`, `gate_dedup_context`) **absent**, list size bounded (`<= 8` in acceptance)

**When tests must use `full`:**
- Path / multi-repo / adversarial cases that call long-tail tools **directly** over JSON-RPC (`gate_dedup_context`, schema property probes on non-core tools)
- `scripts/qa-multi-repo-proof.mjs` and `scripts/qa-adversarial-audit.mjs` set `GATE_TOOL_MODE: "full"`

**Unit coverage of gating** (`src/test.ts` Test 45–47):
- `resolveToolMode({ GATE_TOOL_MODE: "catalog"|"full" })`
- `shouldRegisterTool("gate_invoke"|"gate_memory", mode)`
- `handleInvoke` → `gate_help`
- `handleGateInit` reports `toolMode`

**Rule for new tests:** match the surface under test — schema/discovery → catalog; direct long-tail RPC → full; document the choice in the spawn `env` block.

## Security Regression

**Entry:** `npm run test:security` → `src/security-regression.ts`

**Covers:**
- Nested valid resolve under `GATE_PROJECT_ROOT`
- Symlink file/dir escape, prefix-confusion sibling paths
- Sensitive paths (`.ssh`, `.aws`)
- Non-existent outputs under symlink escape
- Arbitrary `projectRoot` rejection
- `handleDedupContext` host-file rejection outside boundary
- Proxy disabled by default; per-project proxy isolation when `GATE_ENABLE_PROXY=1`
- Uses `dist/scripts/mock-mcp-server.js` for proxy fixtures

## Adversarial QA

**Entry:** `npm run test:qa-adversarial` (also chained from `npm test`)

**File:** `scripts/qa-adversarial-audit.mjs` — “scenarios NOT covered by `src/test.ts` helpers”

**Approach:**
- Spawn `dist/main.js` with cwd = locked sibling, `GATE_PROJECT_ROOT` = parent, `GATE_TOOL_MODE=full`
- Raw newline-delimited JSON-RPC (same transport style as acceptance)
- Cases: absolute path under wide root without `projectRoot`; relative path vs cwd; `projectRoot` narrowing; unified cache partition / DEDUP; sibling empty stats; boundary errors; `gate_dedup_context` cache_hit; schema `projectRoot` on dedup + session_stats; direct `handleCompressFile` import for outside-narrow-root throw
- Emits JSON summary `{ adversarial: "PASS"|"FAIL", results: [...] }`; exits 1 on any failure

**Companion:** `scripts/qa-multi-repo-proof.mjs` — compress/cache/DEDUP/billingScope/`gate_init` across multi-repo fixture with `GATE_TOOL_MODE=full`

## Doctor

**CLI test:** `npm run test:doctor` → `node dist/main.js doctor --strict --json`

**Implementation:** `src/doctor.ts` (`runDoctor`, `formatDoctorReport`)

**Behavior under test:**
- Installation diagnostics + MCP initialize via SDK client/stdio transport
- Child server env forces `GATE_TOOL_MODE: "catalog"` even if parent exported `full`
- Required tools (`EXPECTED_TOOLS`): `gate_init`, `gate_graph_query`, `gate_compress_file`, `gate_session_stats`, `gate_help`, `gate_invoke`
- `--strict` fails the process on check failures; `--json` for machine output
- Also smoke-tested inside `src/test.ts` (Test 41: `runDoctor` end-to-end)

## MCP Acceptance & Inspector

**Acceptance** — `npm run test:mcp` → `scripts/test-mcp-acceptance.mjs`:
- Spawns `dist/main.js` with temp fixture root, large JSON (≥2MB), `GATE_TOOL_MODE=catalog`
- Handshake `initialize` / `notifications/initialized`; protocol `2025-03-26`; server name `gatemcp`
- `tools/list` must include catalog core set + `gate_invoke`; must hide `gate_memory`; length `<= 8`
- Exercises `gate_session_stats`, `gate_init`, `gate_help`, `gate_graph_query` search, dual `gate_compress_file` (DEDUP on second), unknown tool + invalid args error paths, graceful SIGTERM, stderr vs stdout separation

**Inspector** — `npm run test:mcp-inspector` → `scripts/test-mcp-inspector.mjs`:
- `npx --yes @modelcontextprotocol/inspector@1.0.0 --cli <node> dist/main.js --method tools/list`
- Env: `GATE_TOOL_MODE=catalog`, 90s timeout
- Asserts required catalog tools present; `gate_dedup_context` absent; `gate_compress_file` schema includes `projectRoot`

## Mocking

**Framework:** Not detected (no Sinon/Jest mocks)

**Patterns:**
- Real temp filesystems and SQLite paths under `os.tmpdir()`
- Mock downstream MCP via `dist/scripts/mock-mcp-server.js` for proxy isolation tests
- Env var save/restore helpers (`restoreEnv` in security-regression)

**What to Mock:**
- Prefer not to mock path guard / compress / graph — hit real handlers with fixtures

**What NOT to Mock:**
- Do not stub `GATE_TOOL_MODE` resolution when the test’s purpose is schema surface — set the env on the child process instead

## Fixtures and Factories

**Test Data:**
```typescript
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gate-symbol-viz-"));
process.env.GATE_PROJECT_ROOT = tmp;
fs.writeFileSync(path.join(tmp, "a.js"), "export function alphaHelper() { return 1; }\n");
```

**Location:**
- Checked-in: `test-fixtures/multi-repo-web/` (`app.js`, `styles.css`, `index.html`, …)
- Ephemeral: `fs.mkdtempSync` under `/tmp` with `.gate-mcp/cache.db` overrides via `GATE_CACHE_DB`

## Coverage

**Requirements:** None enforced via coverage %. Release quality = `npm run qa` green

**View Coverage:** Not applicable

## Test Types

**Unit / handler tests:**
- `src/test.ts` — compress depths, graph queries, memory CRUD, proxy, validate, session stats, init, doctor smoke, toolMode/invoke, symbol_map/export_html

**Security / storage regressions:**
- `src/security-regression.ts`, `src/storage-regression.ts`

**Integration / e2e (stdio MCP):**
- `scripts/test-mcp-acceptance.mjs`, `scripts/qa-multi-repo-proof.mjs`, `scripts/qa-adversarial-audit.mjs`

**External tool smoke:**
- `scripts/test-mcp-inspector.mjs` (official MCP Inspector CLI)

**Production / package / plugin:**
- `scripts/production-regression.mjs`, `scripts/test-packed-package.mjs`, `scripts/test-plugin-command.mjs`

**Consistency / supply chain:**
- `scripts/check-release-consistency.mjs`, `npm run check:dependencies`, `npm run audit:prod`

**Stress:**
- `src/stress-test.ts` via `npm run stress` (included in `qa`)

## Common Patterns

**Async Testing:**
```typescript
await assert.rejects(
  handleDedupContext({ action: "check", filePath: path.join(outside, "secret.txt") }),
  /outside project boundary/
);
```

**Error Testing:**
```typescript
try {
  await handleCompressFile({ filePath: "/nonexistent/file.ts" });
  failed++; // should have thrown
} catch (err) {
  passed++;
}
```

**JSON-RPC child helper (scripts):**
```javascript
function send(method, params) {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return waitForId(id);
}
```

**Adding a new test (prescriptive):**
1. Prefer extending `src/test.ts` for handler-level behavior
2. Add `scripts/qa-*.mjs` or `*-regression.ts` when you need process isolation, cwd tricks, or packaging
3. Set `GATE_TOOL_MODE` explicitly on spawned servers (catalog for discovery; full for long-tail RPC)
4. Wire a dedicated `npm run test:*` script if the suite should run in CI/`qa`
5. Keep stdout clean for MCP children; assert on stderr / returned JSON only

---

*Testing analysis: 2026-07-25*
