#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const readJson = (relative) =>
  JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));

const pkg = readJson("package.json");
const lock = readJson("package-lock.json");
const plugin = readJson("plugins/gatemcp/.codex-plugin/plugin.json");
const mcp = readJson("plugins/gatemcp/.mcp.json");
const versionSource = fs.readFileSync(path.join(root, "src/version.ts"), "utf8");
const sourceMatch = versionSource.match(/GATEMCP_VERSION\s*=\s*["']([^"']+)/);
const packageSpec = mcp.mcpServers?.gatemcp?.args?.find((arg) =>
  arg.startsWith("--package=@gatemcp/cli@"),
);
const approvedScripts = mcp.mcpServers?.gatemcp?.args?.find((arg) =>
  arg.startsWith("--allow-scripts="),
);
const pluginApprovedScripts = new Set(
  approvedScripts?.split("=").at(-1)?.split(",") ?? [],
);
const installScriptPackages = Object.entries(lock.packages ?? {})
  .filter(([, metadata]) => metadata?.hasInstallScript)
  .map(([packagePath, metadata]) => {
    const name = packagePath.split("node_modules/").at(-1);
    assert.ok(name, `cannot resolve package name from lock path: ${packagePath}`);
    return { name, exact: `${name}@${metadata.version}` };
  });
const pluginPin = packageSpec?.split("@").at(-1);
const pluginBaseVersion = String(plugin.version).split("+")[0];

assert.ok(sourceMatch, "src/version.ts has no GATEMCP_VERSION literal");
assert.equal(pkg.version, sourceMatch[1], "package and source versions differ");
assert.equal(lock.version, pkg.version, "package-lock root version differs");
assert.equal(lock.packages?.[""]?.version, pkg.version, "lock package version differs");
assert.ok(pluginPin, "plugin MCP command has no exact @gatemcp/cli pin");
assert.ok(
  mcp.mcpServers?.gatemcp?.args?.includes("--strict-allow-scripts"),
  "plugin MCP command does not enforce explicit install-script approvals",
);
assert.ok(
  pluginApprovedScripts.has("better-sqlite3"),
  "plugin MCP command does not approve the SQLite native build",
);
for (const dependency of installScriptPackages) {
  assert.equal(
    pkg.allowScripts?.[dependency.exact],
    true,
    `npm 12 install script is not exactly approved: ${dependency.exact}`,
  );
  assert.ok(
    pluginApprovedScripts.has(dependency.name),
    `plugin MCP command does not approve install script: ${dependency.name}`,
  );
}
assert.equal(
  pluginBaseVersion,
  pluginPin,
  "plugin manifest base version and MCP package pin differ",
);

const requirePublishedAlignment = process.env.GATE_REQUIRE_PLUGIN_VERSION_MATCH === "1";
if (requirePublishedAlignment) {
  assert.equal(pluginPin, pkg.version, "plugin pin does not match release version");
}

process.stdout.write(
  `${JSON.stringify(
    {
      passed: true,
      sourceVersion: pkg.version,
      pluginPin,
      pluginCachebuster: String(plugin.version).includes("+")
        ? String(plugin.version).split("+").slice(1).join("+")
        : null,
      approvedInstallScripts: installScriptPackages.length,
      deploymentState:
        pluginPin === pkg.version ? "aligned" : "source-staged-plugin-on-published-version",
    },
    null,
    2,
  )}\n`,
);
