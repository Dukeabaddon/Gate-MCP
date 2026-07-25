#!/usr/bin/env node
/**
 * Official MCP Inspector CLI smoke (CI-friendly).
 * Docs: https://modelcontextprotocol.io/docs/tools/inspector
 *
 * Playwright powers Inspector's own UI tests — we use Inspector CLI here,
 * which is the supported way to automate MCP handshake + tools/list.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repo = path.resolve(import.meta.dirname, "..");
const distMain = path.join(repo, "dist", "main.js");
assert.ok(fs.existsSync(distMain), `build first: ${distMain}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gate-inspector-"));
const cacheDb = path.join(tmp, "cache.db");

const args = [
  "--yes",
  "@modelcontextprotocol/inspector@1.0.0",
  "--cli",
  process.execPath,
  distMain,
  "--method",
  "tools/list",
];

const child = spawn("npx", args, {
  cwd: tmp,
  env: {
    ...process.env,
    GATE_PROJECT_ROOT: tmp,
    GATE_CACHE_DB: cacheDb,
    DISABLE_CONSOLE_OUTPUT: "true",
    // Default product surface is catalog mode.
    GATE_TOOL_MODE: "catalog",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (c) => {
  stdout += c;
});
child.stderr.on("data", (c) => {
  stderr += c;
});

const code = await new Promise((resolve) => {
  child.on("close", resolve);
  setTimeout(() => {
    child.kill("SIGTERM");
    resolve(124);
  }, 90_000);
});

try {
  fs.rmSync(tmp, { recursive: true, force: true });
} catch {
  // ignore
}

if (code !== 0) {
  process.stderr.write(stderr.slice(-4000));
  process.stderr.write(stdout.slice(-2000));
  throw new Error(`inspector CLI exited ${code}`);
}

let payload;
try {
  payload = JSON.parse(stdout);
} catch {
  // Inspector may wrap output; find the tools array
  const match = stdout.match(/\{[\s\S]*"tools"\s*:\s*\[[\s\S]*\][\s\S]*\}/);
  assert.ok(match, `no JSON tools payload in inspector output:\n${stdout.slice(0, 500)}`);
  payload = JSON.parse(match[0]);
}

const tools = payload.tools ?? payload.result?.tools;
assert.ok(Array.isArray(tools), "tools/list missing tools array");
const names = new Set(tools.map((t) => t.name));
for (const required of [
  "gate_compress_file",
  "gate_session_stats",
  "gate_init",
  "gate_graph_query",
  "gate_help",
  "gate_invoke",
]) {
  assert.ok(names.has(required), `missing tool ${required}`);
}
assert.ok(
  !names.has("gate_dedup_context"),
  "catalog mode must not list gate_dedup_context (use gate_invoke)"
);

const compress = tools.find((t) => t.name === "gate_compress_file");
assert.ok(
  compress?.inputSchema?.properties?.projectRoot,
  "inspector schema missing compress projectRoot"
);

process.stdout.write(
  `${JSON.stringify(
    {
      passed: true,
      toolCount: tools.length,
      inspector: "@modelcontextprotocol/inspector@1.0.0 --cli tools/list",
    },
    null,
    2
  )}\n`
);
