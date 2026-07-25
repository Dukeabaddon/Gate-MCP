#!/usr/bin/env node
/**
 * Consumer install proof: pack (or fetch) @gatemcp/cli@0.5.7 and exercise it
 * against the HTML/CSS/JS fixture as a fresh project — not the Gate source tree.
 *
 * Usage:
 *   node scripts/qa-consumer-html-install.mjs
 *   GATE_CONSUMER_PACKAGE=@gatemcp/cli@0.5.7 node scripts/qa-consumer-html-install.mjs
 *   GATE_CONSUMER_PACKAGE=file:./gatemcp-cli-0.5.7.tgz node ...
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureSrc = path.join(repoRoot, "test-fixtures", "multi-repo-web");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "gate-consumer-html-"));
const projectRoot = path.join(work, "web-app");
const packDir = path.join(work, "pack");

fs.mkdirSync(projectRoot, { recursive: true });
fs.mkdirSync(packDir, { recursive: true });
fs.cpSync(fixtureSrc, projectRoot, { recursive: true });
const cacheDb = path.join(projectRoot, ".gate-mcp", "cache.db");
fs.mkdirSync(path.dirname(cacheDb), { recursive: true });

const expectedVersion = "0.5.7";
let packageSpec = process.env.GATE_CONSUMER_PACKAGE?.trim();

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    ...opts,
  });
  if (result.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed (${result.status})\n${result.stdout}\n${result.stderr}`
    );
  }
  return result;
}

if (!packageSpec) {
  // Pack the local release tree (same bits that go to npm).
  run("npm", ["pack", "--pack-destination", packDir], { cwd: repoRoot });
  const tgz = fs.readdirSync(packDir).find((name) => name.endsWith(".tgz"));
  assert.ok(tgz, "npm pack produced no tarball");
  packageSpec = path.join(packDir, tgz);
}

const allowScripts =
  "better-sqlite3,sharp,tesseract.js,tree-sitter,tree-sitter-bash,tree-sitter-c," +
  "tree-sitter-c-sharp,tree-sitter-cli,tree-sitter-cpp,tree-sitter-css,tree-sitter-go," +
  "tree-sitter-html,tree-sitter-java,tree-sitter-javascript,tree-sitter-json," +
  "tree-sitter-kotlin,tree-sitter-php,tree-sitter-python,tree-sitter-ruby," +
  "tree-sitter-rust,tree-sitter-svelte,tree-sitter-swift,tree-sitter-typescript," +
  "tree-sitter-vue,tree-sitter-yaml";

const isFileSpec =
  packageSpec.startsWith("file:") ||
  packageSpec.endsWith(".tgz") ||
  path.isAbsolute(packageSpec);
const npmPackageArg = isFileSpec
  ? packageSpec.startsWith("file:")
    ? packageSpec
    : `file:${path.resolve(packageSpec)}`
  : packageSpec;

// Resolve the installed package binary via npm exec (fresh cache).
const npmCache = path.join(work, "npm-cache");
const doctor = run(
  "npm",
  [
    "exec",
    "--yes",
    `--package=${npmPackageArg}`,
    "--strict-allow-scripts",
    `--allow-scripts=${allowScripts}`,
    "--",
    "gatemcp",
    "doctor",
    projectRoot,
    "--strict",
    "--json",
  ],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      npm_config_cache: npmCache,
      GATE_PROJECT_ROOT: projectRoot,
      GATE_CACHE_DB: cacheDb,
      GATE_TOOL_MODE: "catalog",
    },
    maxBuffer: 4 * 1024 * 1024,
  }
);

const doctorReport = JSON.parse(doctor.stdout);
assert.equal(doctorReport.ok, true, `doctor not ok: ${doctor.stdout}`);
assert.equal(doctorReport.version, expectedVersion);
assert.ok(doctorReport.discoveredTools.includes("gate_invoke"));
assert.ok(!doctorReport.discoveredTools.includes("gate_memory"));

const child = spawn(
  "npm",
  [
    "exec",
    "--yes",
    `--package=${npmPackageArg}`,
    "--strict-allow-scripts",
    `--allow-scripts=${allowScripts}`,
    "--",
    "gatemcp",
  ],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      npm_config_cache: npmCache,
      GATE_PROJECT_ROOT: projectRoot,
      GATE_CACHE_DB: cacheDb,
      GATE_TOOL_MODE: "catalog",
      DISABLE_CONSOLE_OUTPUT: "true",
    },
    stdio: ["pipe", "pipe", "pipe"],
  }
);

let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

const responses = new Map();
const waiters = new Map();
const lines = readline.createInterface({ input: child.stdout });
lines.on("line", (line) => {
  try {
    const message = JSON.parse(line);
    if (message.id !== undefined) {
      const waiter = waiters.get(message.id);
      if (waiter) {
        waiters.delete(message.id);
        waiter.resolve(message);
      } else {
        responses.set(message.id, message);
      }
    }
  } catch {
    // ignore non-JSON
  }
});

let nextId = 1;
function send(method, params) {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    const existing = responses.get(id);
    if (existing) {
      responses.delete(id);
      resolve(existing);
      return;
    }
    const timer = setTimeout(() => {
      waiters.delete(id);
      reject(new Error(`${method} timed out`));
    }, 60_000);
    waiters.set(id, {
      resolve: (message) => {
        clearTimeout(timer);
        resolve(message);
      },
    });
  });
}

function toolPayload(message, label) {
  assert.ok(!message.error, `${label}: ${JSON.stringify(message.error)}`);
  assert.notEqual(message.result?.isError, true, `${label} isError`);
  return JSON.parse(message.result.content[0].text);
}

try {
  const initMsg = await send("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "gate-consumer-html", version: "1.0.0" },
  });
  assert.equal(initMsg.result.serverInfo.name, "gatemcp");
  assert.equal(initMsg.result.serverInfo.version, expectedVersion);
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`
  );

  const listed = await send("tools/list", {});
  const names = listed.result.tools.map((t) => t.name);
  for (const required of [
    "gate_init",
    "gate_compress_file",
    "gate_graph_query",
    "gate_session_stats",
    "gate_help",
    "gate_invoke",
  ]) {
    assert.ok(names.includes(required), `missing ${required}`);
  }
  assert.ok(!names.includes("gate_memory"), "catalog must hide gate_memory");

  const gateInit = toolPayload(
    await send("tools/call", {
      name: "gate_init",
      arguments: { projectRoot },
    }),
    "gate_init"
  );
  assert.equal(gateInit.version, expectedVersion);
  assert.equal(gateInit.projectRoot, projectRoot);
  assert.equal(gateInit.toolMode, "catalog");
  assert.equal(gateInit.cache.kind, "sqlite");
  assert.equal(gateInit.cache.persistent, true);

  const jsPath = path.join(projectRoot, "app.js");
  const compressed = toolPayload(
    await send("tools/call", {
      name: "gate_compress_file",
      arguments: {
        filePath: jsPath,
        depth: "signature",
        projectRoot,
      },
    }),
    "compress app.js"
  );
  assert.ok(compressed.originalTokens > 0);
  assert.equal(compressed.billingScope, "tool_payload_only");

  const cssViaInvoke = toolPayload(
    await send("tools/call", {
      name: "gate_invoke",
      arguments: {
        tool: "gate_compress_file",
        args: {
          filePath: path.join(projectRoot, "styles.css"),
          depth: "structure",
          projectRoot,
        },
      },
    }),
    "invoke→compress styles.css"
  );
  assert.equal(cssViaInvoke.tool, "gate_compress_file");
  assert.ok(cssViaInvoke.result?.content || cssViaInvoke.result?.type);

  const html = toolPayload(
    await send("tools/call", {
      name: "gate_compress_file",
      arguments: {
        filePath: path.join(projectRoot, "index.html"),
        depth: "structure",
        projectRoot,
      },
    }),
    "compress index.html"
  );
  assert.ok(html.originalTokens >= html.optimizedTokens);

  const stats = toolPayload(
    await send("tools/call", {
      name: "gate_session_stats",
      arguments: { projectRoot },
    }),
    "session_stats"
  );
  assert.ok(stats.files_considered >= 2);

  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));

  process.stdout.write(
    JSON.stringify(
      {
        passed: true,
        packageSpec: npmPackageArg,
        expectedVersion,
        projectRoot,
        doctorOk: doctorReport.ok,
        tools: names,
        gateInit: {
          version: gateInit.version,
          toolMode: gateInit.toolMode,
          cache: gateInit.cache,
        },
        compress: {
          jsSavings: compressed.savingsPercent,
          htmlType: html.type,
        },
        stats: {
          files_considered: stats.files_considered,
          files_compressed: stats.files_compressed,
          cache_hits: stats.cache_hits,
        },
      },
      null,
      2
    ) + "\n"
  );
} catch (err) {
  if (!child.killed) child.kill("SIGKILL");
  process.stderr.write(stderr.slice(-4000));
  throw err;
} finally {
  lines.close();
  try {
    fs.rmSync(work, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
