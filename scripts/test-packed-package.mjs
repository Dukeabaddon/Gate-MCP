#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gatemcp-package-"));

try {
  const packed = spawnSync("npm", ["pack", "--pack-destination", temporaryRoot], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(packed.status, 0, packed.stderr || packed.stdout);

  const packagePath = path.join(
    temporaryRoot,
    `gatemcp-cli-${pkg.version}.tgz`,
  );
  assert.ok(fs.existsSync(packagePath), `packed artifact missing: ${packagePath}`);

  const smoke = spawnSync(process.execPath, ["scripts/test-plugin-command.mjs"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GATE_PLUGIN_PACKAGE_SPEC: packagePath,
      GATE_PLUGIN_EXPECTED_VERSION: pkg.version,
      GATE_PLUGIN_EXPECT_MEASUREMENT_SCOPE: "1",
    },
  });
  assert.equal(smoke.status, 0, smoke.stderr || smoke.stdout);

  process.stdout.write(smoke.stdout);
  process.stdout.write(
    `${JSON.stringify({ passed: true, package: path.basename(packagePath) })}\n`,
  );
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
