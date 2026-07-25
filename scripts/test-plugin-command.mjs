#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const pluginRoot = path.join(repositoryRoot, "plugins", "gatemcp");
const manifestPath = path.join(pluginRoot, ".codex-plugin", "plugin.json");
const mcpPath = path.join(pluginRoot, ".mcp.json");
const marketplacePath = path.join(repositoryRoot, ".agents", "plugins", "marketplace.json");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const mcp = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
const marketplace = JSON.parse(fs.readFileSync(marketplacePath, "utf8"));
const pkg = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
);
const server = mcp.mcpServers?.gatemcp;
const packageOverride = process.env.GATE_PLUGIN_PACKAGE_SPEC;
const expectedVersion = process.env.GATE_PLUGIN_EXPECTED_VERSION;
const pluginPin = `--package=@gatemcp/cli@${pkg.version}`;
const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gatemcp-plugin-"));
const installedPluginRoot = path.join(isolatedRoot, "gatemcp");
fs.cpSync(pluginRoot, installedPluginRoot, { recursive: true });

assert.equal(manifest.name, "gatemcp");
assert.equal(manifest.mcpServers, "./.mcp.json");
assert.equal(marketplace.name, "dukeabaddon-gate-mcp");
assert.equal(marketplace.plugins?.[0]?.name, "gatemcp");
assert.equal(marketplace.plugins?.[0]?.source?.path, "./plugins/gatemcp");
assert.equal(server?.command, "npm");
assert.equal(server?.args?.[0], "exec");
assert.ok(server?.args?.includes("--yes"));
assert.ok(server?.args?.includes("--strict-allow-scripts"));
assert.ok(
  server?.args
    ?.find((arg) => arg.startsWith("--allow-scripts="))
    ?.includes("better-sqlite3"),
);
assert.ok(
  server?.args?.includes(pluginPin),
  `plugin MCP pin missing ${pluginPin}`,
);
assert.deepEqual(server?.args?.slice(-2), ["--", "gatemcp"]);
assert.ok(!JSON.stringify(server).includes(repositoryRoot));

const transportCommand = server.command;
const transportArgs = packageOverride
  ? server.args.map((arg) =>
      arg.startsWith("--package=") ? `--package=${packageOverride}` : arg,
    )
  : server.args;

const transport = new StdioClientTransport({
  command: transportCommand,
  args: transportArgs,
  cwd: installedPluginRoot,
  stderr: "pipe",
  env: {
    ...process.env,
    GATE_PROJECT_ROOT: repositoryRoot,
    GATE_TOOL_MODE: "catalog",
    npm_config_cache: path.join(isolatedRoot, "npm-cache"),
  },
});
let stderr = "";
transport.stderr?.setEncoding("utf8");
transport.stderr?.on("data", (chunk) => {
  stderr += chunk;
});

const client = new Client(
  { name: "gatemcp-plugin-command-test", version: "1.0.0" },
  { capabilities: {} },
);

const timeoutMs = packageOverride ? 120_000 : 60_000;
let timer;
const withTimeout = (promise, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));

const invoke = async (name, args = {}) => {
  const result = await withTimeout(
    client.callTool({ name, arguments: args }),
    `${name} invocation`,
  );
  assert.notEqual(result.isError, true, `${name} returned an MCP error`);
  const text = result.content?.find((item) => item.type === "text")?.text;
  assert.ok(text, `${name} returned no text content`);
  return JSON.parse(text);
};

try {
  await withTimeout(client.connect(transport), "plugin command initialize");

  const listed = await withTimeout(client.listTools(), "plugin command tools/list");

  const toolNames = listed.tools.map((tool) => tool.name).sort();
  const requiredTools = [
    "gate_init",
    "gate_graph_query",
    "gate_compress_file",
    "gate_session_stats",
    "gate_help",
    "gate_invoke",
  ];
  for (const name of requiredTools) assert.ok(toolNames.includes(name), `${name} missing`);
  assert.ok(
    !toolNames.includes("gate_memory"),
    "catalog plugin surface must hide gate_memory",
  );

  const init = await invoke("gate_init", { projectRoot: repositoryRoot });
  assert.equal(init.projectRoot, repositoryRoot);
  assert.equal(init.cache?.persistent, true, "gate_init did not open SQLite");
  const graph = await invoke("gate_graph_query", {
    query: "",
    queryType: "stats",
    projectRoot: repositoryRoot,
  });
  assert.ok(graph.result || graph.stats || graph.response, "gate_graph_query returned no result");
  const compressed = await invoke("gate_compress_file", {
    filePath: path.join(repositoryRoot, "package.json"),
    depth: "structure",
  });
  assert.ok(compressed.content, "gate_compress_file returned no content");
  const help = await invoke("gate_help", { tool: "directory" });
  assert.match(help.documentation, /gate_init/);
  const stats = await invoke("gate_session_stats");
  if (process.env.GATE_PLUGIN_EXPECT_MEASUREMENT_SCOPE === "1") {
    assert.equal(
      stats.measurement_scope,
      "serialized_tool_result_excluding_mcp_envelope",
    );
  }
  if (packageOverride) {
    assert.doesNotMatch(
      stderr,
      /ERESOLVE overriding peer dependency|Could not locate the bindings file|using in-memory cache/,
      "packed install emitted a dependency or SQLite fallback warning",
    );
  }

  const serverVersion = client.getServerVersion();
  if (expectedVersion) assert.equal(serverVersion?.version, expectedVersion);

  process.stdout.write(
    JSON.stringify(
      {
        passed: true,
        manifestCommand: [server.command, ...server.args],
        testedCommand: [transportCommand, ...transportArgs],
        serverVersion,
        toolCount: toolNames.length,
        requiredTools,
        invokedTools: requiredTools,
        persistentCache: init.cache.persistent,
        measurementScope: stats.measurement_scope ?? null,
        stderrBytes: Buffer.byteLength(stderr),
      },
      null,
      2,
    ) + "\n",
  );
} catch (error) {
  process.stderr.write(`Plugin command stderr:\n${stderr}\n`);
  throw error;
} finally {
  clearTimeout(timer);
  await client.close().catch(() => {});
  fs.rmSync(isolatedRoot, { recursive: true, force: true });
}
