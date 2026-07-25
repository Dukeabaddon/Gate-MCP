#!/usr/bin/env node
/**
 * Adversarial audit — scenarios NOT covered by src/test.ts helpers.
 * Uses raw JSON-RPC + env/cwd tricks; does not import test.ts.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const repo = path.resolve(import.meta.dirname, "..");
const distMain = path.join(repo, "dist", "main.js");
assert.ok(fs.existsSync(distMain), `build required: ${distMain}`);

const fixture = path.join(repo, "test-fixtures", "multi-repo-web");
const parent = fs.mkdtempSync(path.join(os.tmpdir(), "gate-adv-"));
const locked = path.join(parent, "Documents-RAG");
const playground = path.join(parent, "playground-web");
fs.mkdirSync(locked);
fs.mkdirSync(playground);
for (const name of ["app.js", "styles.css"]) {
  fs.copyFileSync(path.join(fixture, name), path.join(playground, name));
}

const results = [];

function spawnServer(cwd) {
  const cacheDb = path.join(parent, ".gate-mcp", "cache.db");
  fs.mkdirSync(path.dirname(cacheDb), { recursive: true });
  const child = spawn(process.execPath, [distMain], {
    cwd,
    env: {
      ...process.env,
      GATE_PROJECT_ROOT: parent,
      GATE_CACHE_DB: cacheDb,
      DISABLE_CONSOLE_OUTPUT: "true",
      // Direct tool calls for path-guard adversarial cases.
      GATE_TOOL_MODE: "full",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (c) => {
    stderr += c;
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
      // ignore
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
        reject(new Error(`${method} timeout\n${stderr.slice(-1500)}`));
      }, 15_000);
      waiters.set(id, {
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
  }

  return {
    send,
    notify: (method, params) => {
      const payload = { jsonrpc: "2.0", method };
      if (params !== undefined) payload.params = params;
      child.stdin.write(`${JSON.stringify(payload)}\n`);
    },
    kill: () => child.kill("SIGTERM"),
    getStderr: () => stderr,
  };
}

async function callTool(server, name, arguments_) {
  const msg = await server.send("tools/call", { name, arguments: arguments_ });
  assert.ok(!msg.error, `rpc error: ${JSON.stringify(msg.error)}`);
  const text = msg.result?.content?.[0]?.text;
  assert.equal(typeof text, "string", "missing tool text");
  return JSON.parse(text);
}

try {
  const server = spawnServer(locked);
  await server.send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "qa-adversarial", version: "1" },
  });
  server.notify("notifications/initialized");

  const listed = await server.send("tools/list", {});
  const compressTool = listed.result.tools.find((t) => t.name === "gate_compress_file");
  const schemaProps = compressTool?.inputSchema?.properties ?? {};
  results.push({
    case: "tools/list projectRoot property exists",
    pass: Boolean(schemaProps.projectRoot),
    detail: schemaProps.projectRoot?.description?.slice(0, 80) ?? "missing",
  });

  const absPlaygroundJs = path.join(playground, "app.js");
  const wideNoRoot = await callTool(server, "gate_compress_file", {
    filePath: absPlaygroundJs,
    depth: "signature",
  });
  results.push({
    case: "absolute under GATE_PROJECT_ROOT without projectRoot (cwd=locked sibling)",
    pass: !wideNoRoot.error && wideNoRoot.baseline === "file",
    detail: wideNoRoot.error ?? `type=${wideNoRoot.type}`,
  });

  const relNoRoot = await callTool(server, "gate_compress_file", {
    filePath: "app.js",
    depth: "signature",
  });
  results.push({
    case: "relative app.js without projectRoot resolves against cwd (locked) — expect fail",
    pass: Boolean(relNoRoot.error),
    detail: String(relNoRoot.error ?? "unexpected success"),
  });

  const relWithRoot = await callTool(server, "gate_compress_file", {
    filePath: "app.js",
    depth: "signature",
    projectRoot: playground,
  });
  results.push({
    case: "relative app.js with projectRoot=playground shares partition (DEDUP)",
    pass: !relWithRoot.error && String(relWithRoot.note).includes("[DEDUP]"),
    detail: relWithRoot.error ?? relWithRoot.note?.slice(0, 80),
  });

  const statsAfterWide = await callTool(server, "gate_session_stats", {
    projectRoot: playground,
  });
  const statsParent = await callTool(server, "gate_session_stats", {
    projectRoot: parent,
  });
  results.push({
    case: "unified partition: child scope and parent scope both see the cached file",
    pass:
      (statsAfterWide.totalEntries ?? 0) >= 1 &&
      (statsParent.totalEntries ?? 0) >= 1 &&
      statsAfterWide.billingScope === "tool_payload_only",
    detail: `child=${statsAfterWide.totalEntries} parent=${statsParent.totalEntries} billing=${statsAfterWide.billingScope}`,
  });

  const statsLockedEmpty = await callTool(server, "gate_session_stats", {
    projectRoot: locked,
  });
  results.push({
    case: "sibling scope with no files stays empty for path-filtered totals",
    pass: (statsLockedEmpty.totalEntries ?? 0) === 0,
    detail: `entries=${statsLockedEmpty.totalEntries}`,
  });

  const outsideNarrow = await callTool(server, "gate_compress_file", {
    filePath: absPlaygroundJs,
    depth: "signature",
    projectRoot: locked,
  });
  results.push({
    case: "absolute file in playground but projectRoot=locked sibling",
    pass: Boolean(outsideNarrow.error) && /outside project boundary/.test(String(outsideNarrow.error)),
    detail: String(outsideNarrow.error ?? "no error"),
  });

  const dedupCheck = await callTool(server, "gate_dedup_context", {
    action: "check",
    filePath: absPlaygroundJs,
    projectRoot: playground,
  });
  results.push({
    case: "gate_dedup_context check with matching projectRoot sees auto-cache",
    pass: dedupCheck.status === "cache_hit",
    detail: dedupCheck.status,
  });

  const statsScoped = await callTool(server, "gate_session_stats", {
    projectRoot: playground,
  });
  results.push({
    case: "gate_session_stats with projectRoot sees entries",
    pass: (statsScoped.totalEntries ?? 0) >= 1,
    detail: `entries=${statsScoped.totalEntries}`,
  });

  const listedAgain = await server.send("tools/list", {});
  const dedupSchema =
    listedAgain.result.tools.find((t) => t.name === "gate_dedup_context")
      ?.inputSchema?.properties ?? {};
  const statsSchema =
    listedAgain.result.tools.find((t) => t.name === "gate_session_stats")
      ?.inputSchema?.properties ?? {};
  results.push({
    case: "tools/list dedup+session_stats expose projectRoot",
    pass: Boolean(dedupSchema.projectRoot && statsSchema.projectRoot),
    detail: `dedup=${Boolean(dedupSchema.projectRoot)} stats=${Boolean(statsSchema.projectRoot)}`,
  });

  server.kill();

  // Direct handler import — path outside narrow root without MCP wrapper
  const { handleCompressFile } = await import(path.join(repo, "dist", "tools", "compressFile.js"));
  process.env.GATE_PROJECT_ROOT = parent;
  let directErr = null;
  try {
    await handleCompressFile({
      filePath: path.join(locked, "ghost.js"),
      projectRoot: playground,
    });
  } catch (e) {
    directErr = e;
  }
  results.push({
    case: "direct handleCompressFile: file outside narrowed projectRoot",
    pass: directErr !== null && /File not found|outside project boundary/.test(String(directErr)),
    detail: String(directErr ?? "no throw"),
  });

  const failed = results.filter((r) => !r.pass);
  process.stdout.write(
    JSON.stringify(
      {
        adversarial: failed.length === 0 ? "PASS" : "FAIL",
        failedCount: failed.length,
        results,
      },
      null,
      2
    ) + "\n"
  );
  if (failed.length > 0) process.exit(1);
} finally {
  try {
    fs.rmSync(parent, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
