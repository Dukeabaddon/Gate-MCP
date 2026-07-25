#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const { countTextTokens } = await import(
  path.join(repositoryRoot, "dist/lib/tokenCounter.js")
);
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gatemcp-acceptance-"));
const cachePath = path.join(fixtureRoot, ".gate-mcp", "acceptance-cache.db");
fs.mkdirSync(path.dirname(cachePath), { recursive: true });

const symbolPath = path.join(fixtureRoot, "important.ts");
fs.writeFileSync(
  symbolPath,
  [
    "export function acceptanceImportantSymbol(value: number): number {",
    "  return value * 2;",
    "}",
    "",
  ].join("\n"),
);

const jsonPath = path.join(fixtureRoot, "large.json");
const records = Array.from({ length: 30_000 }, (_, index) => ({
  id: index,
  slug: `record-${index}`,
  enabled: index % 2 === 0,
  score: index * 1.25,
  tags: ["gate", "acceptance", `bucket-${index % 25}`],
}));
fs.writeFileSync(
  jsonPath,
  JSON.stringify({ generatedBy: "Gate MCP acceptance", records }, null, 2),
);
const inputBytes = fs.statSync(jsonPath).size;
assert.ok(inputBytes >= 2_000_000, `fixture too small: ${inputBytes} bytes`);

const child = spawn(process.execPath, [path.join(repositoryRoot, "dist/main.js")], {
  cwd: fixtureRoot,
  env: {
    ...process.env,
    GATE_PROJECT_ROOT: fixtureRoot,
    GATE_CACHE_DB: cachePath,
    // Acceptance locks the default catalog surface.
    GATE_TOOL_MODE: "catalog",
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
const stdoutMessages = [];
const stdoutErrors = [];
const lines = readline.createInterface({ input: child.stdout });
lines.on("line", (line) => {
  try {
    const message = JSON.parse(line);
    assert.equal(message.jsonrpc, "2.0");
    stdoutMessages.push(message);
    if (message.id !== undefined) {
      const waiter = waiters.get(message.id);
      if (waiter) {
        waiters.delete(message.id);
        waiter.resolve(message);
      } else {
        responses.set(message.id, message);
      }
    }
  } catch (error) {
    stdoutErrors.push({ line, error });
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
      reject(new Error(`${method} timed out`));
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

function resultOf(message, label) {
  assert.ok(!message.error, `${label} failed: ${JSON.stringify(message.error)}`);
  return message.result;
}

function toolPayload(message, label) {
  const result = resultOf(message, label);
  assert.notEqual(result.isError, true, `${label} returned isError`);
  assert.equal(result.content?.[0]?.type, "text", `${label} returned no text`);
  return JSON.parse(result.content[0].text);
}

function callTool(name, args = {}) {
  return send("tools/call", { name, arguments: args });
}

try {
  const initialized = resultOf(
    await send("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "gatemcp-acceptance", version: "1.0.0" },
    }),
    "initialize",
  );
  assert.equal(initialized.serverInfo.name, "gatemcp");
  assert.equal(initialized.protocolVersion, "2025-03-26");
  notify("notifications/initialized");

  const listed = resultOf(await send("tools/list", {}), "tools/list");
  const toolNames = listed.tools.map((tool) => tool.name);
  const requiredTools = [
    "gate_init",
    "gate_graph_query",
    "gate_compress_file",
    "gate_session_stats",
    "gate_help",
    "gate_invoke",
  ];
  for (const name of requiredTools) {
    assert.ok(toolNames.includes(name), `${name} is not discoverable`);
    const tool = listed.tools.find((candidate) => candidate.name === name);
    assert.equal(tool.inputSchema?.type, "object", `${name} has no object schema`);
  }
  assert.ok(!toolNames.includes("gate_memory"), "catalog mode must hide gate_memory");
  assert.ok(toolNames.includes("gate_invoke"), "catalog mode must expose gate_invoke");
  assert.ok(toolNames.length <= 8, `catalog tools/list too large: ${toolNames.length}`);

  const initialStats = toolPayload(await callTool("gate_session_stats"), "initial stats");
  assert.equal(initialStats.files_considered, 0);
  assert.equal(initialStats.files_compressed, 0);
  assert.equal(initialStats.cache_hits, 0);

  const init = toolPayload(
    await callTool("gate_init", { projectRoot: fixtureRoot }),
    "gate_init",
  );
  assert.equal(init.projectRoot, fixtureRoot);
  assert.equal(init.cache?.persistent, true, "acceptance must use SQLite cache");
  assert.equal(init.cache?.kind, "sqlite");

  const help = toolPayload(await callTool("gate_help"), "gate_help");
  for (const name of requiredTools) {
    assert.ok(help.documentation.includes(name), `help omits ${name}`);
  }

  // Catalog long-tail path: list-only is insufficient — actually dispatch.
  const invokedMemory = toolPayload(
    await callTool("gate_invoke", {
      tool: "gate_memory",
      args: { action: "list", key: "*" },
    }),
    "gate_invoke→gate_memory",
  );
  assert.equal(invokedMemory.tool, "gate_memory");
  assert.ok(invokedMemory.result, "invoke memory missing result");

  const graph = toolPayload(
    await callTool("gate_graph_query", {
      projectRoot: fixtureRoot,
      query: "acceptanceImportantSymbol",
      queryType: "search",
      rebuild: true,
    }),
    "gate_graph_query",
  );
  assert.ok(graph.nodesTraversed > 0, "graph search traversed no nodes");
  assert.ok(
    graph.result.includes("acceptanceImportantSymbol"),
    "graph search missed the known symbol",
  );

  const compressionStart = performance.now();
  const first = toolPayload(
    await callTool("gate_compress_file", { filePath: jsonPath, depth: "structure" }),
    "first compression",
  );
  const compressionMs = performance.now() - compressionStart;
  assert.equal(first.type, "structure");
  assert.equal(first.expanded, false);
  assert.ok(first.originalTokens > first.optimizedTokens);
  assert.equal(
    first.savingsPercent,
    Math.round((1 - first.optimizedTokens / first.originalTokens) * 100),
  );
  assert.ok(Buffer.byteLength(first.content, "utf8") < 65_536);
  assert.ok(compressionMs < 15_000, `large JSON took ${compressionMs}ms`);

  const second = toolPayload(
    await callTool("gate_compress_file", { filePath: jsonPath, depth: "structure" }),
    "cached compression",
  );
  assert.match(second.note, /\[DEDUP\]/);

  const stats = toolPayload(await callTool("gate_session_stats"), "final stats");
  const firstSerialized = JSON.stringify(first, null, 2);
  const secondSerialized = JSON.stringify(second, null, 2);
  assert.equal(stats.files_considered, 2);
  assert.equal(stats.files_compressed, 1);
  assert.equal(stats.cache_hits, 1);
  assert.equal(stats.input_bytes, inputBytes * 2);
  assert.equal(
    stats.output_bytes,
    Buffer.byteLength(firstSerialized, "utf8") +
      Buffer.byteLength(secondSerialized, "utf8"),
  );
  assert.equal(
    stats.estimated_tokens_before,
    first.originalTokens + second.originalTokens,
  );
  assert.equal(
    stats.estimated_tokens_after,
    countTextTokens(firstSerialized) + countTextTokens(secondSerialized),
  );
  assert.ok(Number.isFinite(stats.elapsed_ms) && stats.elapsed_ms >= 0);
  assert.ok(Number.isFinite(stats.session_elapsed_ms) && stats.session_elapsed_ms >= 0);

  const invokedCompress = toolPayload(
    await callTool("gate_invoke", {
      tool: "gate_compress_file",
      args: { filePath: symbolPath, depth: "signature" },
    }),
    "gate_invoke→gate_compress_file",
  );
  assert.equal(invokedCompress.tool, "gate_compress_file");
  assert.ok(
    invokedCompress.result?.content || invokedCompress.result?.type,
    "invoke compress missing payload",
  );

  const badRebuild = await callTool("gate_invoke", {
    tool: "gate_graph_query",
    args: { query: "x", rebuild: "false" },
  });
  assert.ok(
    badRebuild.error || badRebuild.result?.isError === true,
    'gate_invoke must reject rebuild:"false"',
  );

  const unknown = await callTool("gate_unknown_acceptance_tool");
  assert.ok(
    unknown.error || unknown.result?.isError === true,
    "unknown tool did not return an MCP error",
  );

  const invalid = await callTool("gate_compress_file", {});
  assert.ok(
    invalid.error || invalid.result?.isError === true,
    "invalid input did not return an MCP error",
  );

  child.kill("SIGTERM");
  const exit = await Promise.race([
    new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal }))),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("SIGTERM shutdown timed out")), 5_000),
    ),
  ]);
  assert.equal(exit.code, 0, `server exit was ${JSON.stringify(exit)}`);
  assert.equal(stdoutErrors.length, 0, `non-JSON stdout: ${JSON.stringify(stdoutErrors)}`);
  assert.ok(stdoutMessages.length >= 10, "too few JSON-RPC responses captured");
  assert.match(stderr, /Starting gatemcp server/);
  assert.match(stderr, /Compressing file/);
  assert.ok(!stdoutMessages.some((message) => JSON.stringify(message).includes("[gate-mcp]")));

  process.stdout.write(
    JSON.stringify(
      {
        passed: true,
        protocolVersion: initialized.protocolVersion,
        toolsDiscovered: toolNames.length,
        requiredTools,
        largeJson: {
          inputBytes,
          outputBytes: stats.output_bytes,
          tokensBefore: stats.estimated_tokens_before,
          tokensAfter: stats.estimated_tokens_after,
          savingsPercent: first.savingsPercent,
          elapsedMs: Math.round(compressionMs * 100) / 100,
        },
        metrics: stats,
        jsonRpcMessages: stdoutMessages.length,
        stderrBytes: Buffer.byteLength(stderr),
        gracefulExit: exit,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  if (!child.killed) child.kill("SIGKILL");
  lines.close();
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
