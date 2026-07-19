#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const launcher = path.join(
  repositoryRoot,
  "plugins",
  "gatemcp",
  "scripts",
  "launch.mjs",
);
const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "gatemcp-launcher-"),
);
const ownedCache = path.join(temporaryRoot, "owned-cache");
const userCache = path.join(temporaryRoot, "user-cache");
const attemptFile = path.join(temporaryRoot, "attempt.txt");
const fakeNpm = path.join(temporaryRoot, "fake-npm.mjs");
const preflightBroken = path.join(ownedCache, "_npx", "preflight-broken");
const userSentinel = path.join(userCache, "keep.txt");

try {
  fs.mkdirSync(path.join(preflightBroken, "node_modules"), { recursive: true });
  fs.writeFileSync(
    path.join(ownedCache, ".gatemcp-plugin-cache-v1"),
    "test-owned cache\n",
  );
  fs.writeFileSync(path.join(preflightBroken, "package-lock.json"), "{}\n");
  fs.mkdirSync(userCache, { recursive: true });
  fs.writeFileSync(userSentinel, "preserve me\n");

  fs.writeFileSync(
    fakeNpm,
    `import fs from "node:fs";
import path from "node:path";

const attempts = Number(fs.existsSync(process.env.GATE_TEST_ATTEMPT_FILE)
  ? fs.readFileSync(process.env.GATE_TEST_ATTEMPT_FILE, "utf8")
  : "0") + 1;
fs.writeFileSync(process.env.GATE_TEST_ATTEMPT_FILE, String(attempts));
const broken = path.join(process.env.npm_config_cache, "_npx", "retry-broken");
if (attempts === 1) {
  fs.mkdirSync(path.join(broken, "node_modules"), { recursive: true });
  process.stderr.write("npm error code ENOENT\\n");
  process.stderr.write("npm error path " + path.join(broken, "package.json") + "\\n");
  process.exit(254);
}
if (fs.existsSync(broken)) {
  process.stderr.write("retry reused the incomplete cache\\n");
  process.exit(2);
}
process.exit(0);
`,
  );

  const result = spawnSync(
    process.execPath,
    [
      launcher,
      "--yes",
      "--strict-allow-scripts",
      "--package=@gatemcp/cli@0.5.5",
      "--",
      "gatemcp",
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        npm_config_cache: userCache,
        GATE_PLUGIN_NPM_CACHE: ownedCache,
        GATE_PLUGIN_NPM_COMMAND: process.execPath,
        GATE_PLUGIN_NPM_COMMAND_ARGS_JSON: JSON.stringify([fakeNpm]),
        GATE_TEST_ATTEMPT_FILE: attemptFile,
      },
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.readFileSync(attemptFile, "utf8"), "2");
  assert.ok(!fs.existsSync(preflightBroken), "preflight repair did not run");
  assert.match(result.stderr, /Repaired 1 incomplete npm exec cache entry/);
  assert.match(result.stderr, /rebuilding it once/);
  assert.ok(
    !fs.existsSync(path.join(ownedCache, ".startup-lock")),
    "startup lock was not released",
  );
  assert.equal(fs.readFileSync(userSentinel, "utf8"), "preserve me\n");

  process.stdout.write(
    `${JSON.stringify({
      passed: true,
      attempts: 2,
      preflightRepair: true,
      retryRepair: true,
      startupLockReleased: true,
      userNpmCachePreserved: true,
    })}\n`,
  );
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
