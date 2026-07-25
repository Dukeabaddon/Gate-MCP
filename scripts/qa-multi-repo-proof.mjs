#!/usr/bin/env node
/**
 * End-to-end proof for QA: GateMCP multi-repo / compress_file projectRoot gap.
 *
 * Transport matches scripts/test-mcp-acceptance.mjs (newline JSON-RPC on stdio).
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const distMain = path.join(repositoryRoot, "dist", "main.js");
assert.ok(fs.existsSync(distMain), `missing build: ${distMain}`);

const fixture = path.join(repositoryRoot, "test-fixtures", "multi-repo-web");
for (const name of ["app.js", "styles.css", "index.html"]) {
  assert.ok(fs.existsSync(path.join(fixture, name)), `missing fixture ${name}`);
}

const parent = fs.mkdtempSync(path.join(os.tmpdir(), "gate-qa-e2e-"));
const locked = path.join(parent, "Documents-RAG");
const playground = path.join(parent, "playground-web");
fs.mkdirSync(locked);
fs.mkdirSync(playground);
for (const name of ["app.js", "styles.css", "index.html", "README.md"]) {
  fs.copyFileSync(path.join(fixture, name), path.join(playground, name));
}

const cacheDb = path.join(parent, ".gate-mcp", "cache.db");
fs.mkdirSync(path.dirname(cacheDb), { recursive: true });

const child = spawn(process.execPath, [distMain], {
  cwd: locked,
  env: {
    ...process.env,
    GATE_PROJECT_ROOT: parent,
    GATE_CACHE_DB: cacheDb,
    // Schema/path probes need long-tail tools listed.
    GATE_TOOL_MODE: "full",
  },
  stdio: ["pipe", "pipe", "pipe"],
});

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
    // ignore non-JSON stdout noise
  }
});

let nextId = 1;
function send(method, params) {
  const id = nextId++;
  const payload = { jsonrpc: "2.0", id, method };
  if (params !== undefined) payload.params = params;
  child.stdin.write(`${JSON.stringify(payload)}\n`);
  return new Promise((resolve, reject) => {
    const existing = responses.get(id);
    if (existing) {
      responses.delete(id);
      resolve(existing);
      return;
    }
    const timer = setTimeout(() => {
      waiters.delete(id);
      reject(new Error(`${method} timed out\nstderr:\n${stderr.slice(-2000)}`));
    }, 20_000);
    waiters.set(id, {
      resolve: (message) => {
        clearTimeout(timer);
        resolve(message);
      },
    });
  });
}

function notify(method, params) {
  const payload = { jsonrpc: "2.0", method };
  if (params !== undefined) payload.params = params;
  child.stdin.write(`${JSON.stringify(payload)}\n`);
}

function toolBody(message, label) {
  assert.ok(!message.error, `${label} rpc error: ${JSON.stringify(message.error)}`);
  const text = message.result?.content?.[0]?.text;
  assert.ok(typeof text === "string", `${label} missing text content`);
  return JSON.parse(text);
}

try {
  await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "qa-multi-repo-proof", version: "1.0.0" },
  });
  notify("notifications/initialized");

  const tools = await send("tools/list", {});
  const compress = tools.result.tools.find((t) => t.name === "gate_compress_file");
  assert.ok(compress, "gate_compress_file missing");
  assert.ok(
    compress.inputSchema?.properties?.projectRoot,
    "schema missing projectRoot (QA #1)"
  );

  const ok = toolBody(
    await send("tools/call", {
      name: "gate_compress_file",
      arguments: {
        filePath: path.join(playground, "app.js"),
        depth: "signature",
        projectRoot: playground,
      },
    }),
    "compress app.js"
  );
  assert.equal(ok.error, undefined, `compress failed: ${ok.error}`);
  assert.equal(ok.baseline, "file");
  assert.equal(ok.billingScope, "tool_payload_only");
  assert.match(ok.note, /not Cursor billed tokens/);

  const css = toolBody(
    await send("tools/call", {
      name: "gate_compress_file",
      arguments: {
        filePath: "styles.css",
        depth: "structure",
        projectRoot: playground,
      },
    }),
    "compress styles.css"
  );
  assert.equal(css.error, undefined, `css compress failed: ${css.error}`);

  const again = toolBody(
    await send("tools/call", {
      name: "gate_compress_file",
      arguments: {
        filePath: path.join(playground, "app.js"),
        depth: "signature",
        projectRoot: playground,
      },
    }),
    "compress app.js again"
  );
  assert.match(again.note, /\[DEDUP\]/);

  const bad = toolBody(
    await send("tools/call", {
      name: "gate_compress_file",
      arguments: {
        filePath: path.join(playground, "app.js"),
        depth: "signature",
        projectRoot: locked,
      },
    }),
    "narrow reject"
  );
  assert.ok(bad.error, "expected boundary error");
  assert.match(String(bad.error), /outside project boundary/);
  assert.doesNotMatch(String(bad.error), /pass projectRoot/);

  const init = toolBody(
    await send("tools/call", {
      name: "gate_init",
      arguments: { projectRoot: playground },
    }),
    "gate_init"
  );
  assert.ok(init.cache?.kind === "sqlite" || init.cache?.kind === "memory");
  if (!init.cache.persistent) {
    assert.equal(init.cache.path, "(memory)");
    assert.ok(
      typeof init.cache.fallbackReason === "string" &&
        init.cache.fallbackReason.length > 0,
      "QA #3: fallbackReason required when not persistent"
    );
    assert.match(init.note, /in-memory/i);
  } else {
    assert.ok(
      init.cache.path.includes("cache.db") || init.cache.path.includes(".gate-mcp")
    );
  }

  const statsOk = toolBody(
    await send("tools/call", {
      name: "gate_session_stats",
      arguments: { projectRoot: playground },
    }),
    "session_stats scoped"
  );
  assert.ok(
    (statsOk.totalEntries ?? 0) >= 1,
    `session_stats with projectRoot should see cache rows (got ${statsOk.totalEntries})`
  );
  assert.equal(statsOk.billingScope, "tool_payload_only");
  assert.ok(statsOk.cachePartition, "missing cachePartition");

  const statsEmpty = toolBody(
    await send("tools/call", {
      name: "gate_session_stats",
      arguments: { projectRoot: locked },
    }),
    "session_stats wrong root"
  );
  assert.equal(
    statsEmpty.totalEntries,
    0,
    "locked root must not see playground cache paths"
  );

  const unified = toolBody(
    await send("tools/call", {
      name: "gate_compress_file",
      arguments: {
        filePath: path.join(playground, "app.js"),
        depth: "signature",
      },
    }),
    "compress without projectRoot after scoped compress"
  );
  assert.match(unified.note, /\[DEDUP\]/, "unified partition miss");

  const dedupListed = await send("tools/list", {});
  const dedupTool = dedupListed.result.tools.find(
    (t) => t.name === "gate_dedup_context"
  );
  assert.ok(
    dedupTool?.inputSchema?.properties?.projectRoot,
    "gate_dedup_context schema missing projectRoot"
  );
  const statsTool = dedupListed.result.tools.find(
    (t) => t.name === "gate_session_stats"
  );
  assert.ok(
    statsTool?.inputSchema?.properties?.projectRoot,
    "gate_session_stats schema missing projectRoot"
  );

  const dedupCheck = toolBody(
    await send("tools/call", {
      name: "gate_dedup_context",
      arguments: {
        action: "check",
        filePath: "app.js",
        projectRoot: playground,
      },
    }),
    "dedup check"
  );
  assert.equal(dedupCheck.status, "cache_hit", "dedup check should see auto-cache");

  process.stdout.write(
    `${JSON.stringify(
      {
        passed: true,
        compressSchemaHasProjectRoot: true,
        compressOk: true,
        dedupHit: true,
        narrowRejected: true,
        metricsLabeled: true,
        sessionStatsScoped: true,
        cacheKind: init.cache.kind,
        cachePersistent: init.cache.persistent,
        fallbackReason: init.cache.fallbackReason ?? null,
      },
      null,
      2
    )}\n`
  );
} finally {
  child.kill("SIGTERM");
  try {
    fs.rmSync(parent, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
