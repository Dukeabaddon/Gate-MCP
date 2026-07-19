/**
 * Standalone path-boundary regression suite.
 *
 * Run: npm run build && node dist/security-regression.js
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resolveProjectRoot,
  safeResolve,
  safeResolveExistingFile,
} from "./lib/pathGuard.js";
import { handleDedupContext } from "./tools/dedupContext.js";
import {
  closeAllProxies,
  getProxyConnection,
  getProxyStatus,
} from "./lib/proxyClient.js";

type TestCase = {
  name: string;
  run: () => void | Promise<void>;
};

function expectRejected(run: () => unknown, expected: RegExp): void {
  assert.throws(run, expected);
}

function restoreEnv(name: string, previous: string | undefined): void {
  if (previous === undefined) delete process.env[name];
  else process.env[name] = previous;
}

async function main(): Promise<void> {
  const previousRoot = process.env.GATE_PROJECT_ROOT;
  const previousAllowAny = process.env.GATE_ALLOW_ANY_PATH;
  const previousProxyExecution = process.env.GATE_ENABLE_PROXY;
  const fixtureBase = fs.mkdtempSync(path.join(os.tmpdir(), "gate-security-"));
  const workspace = path.join(fixtureBase, "workspace");
  const outside = path.join(fixtureBase, "outside");
  const prefixSibling = `${workspace}-evil`;
  let passed = 0;
  let total = 0;

  try {
    fs.mkdirSync(path.join(workspace, "nested"), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.mkdirSync(prefixSibling, { recursive: true });
    fs.writeFileSync(path.join(workspace, "nested", "valid.txt"), "valid\n");
    fs.writeFileSync(path.join(outside, "secret.txt"), "outside\n");
    fs.writeFileSync(path.join(prefixSibling, "secret.txt"), "prefix\n");

    process.env.GATE_PROJECT_ROOT = workspace;
    delete process.env.GATE_ALLOW_ANY_PATH;
    delete process.env.GATE_ENABLE_PROXY;

    const fileLink = path.join(workspace, "file-link.txt");
    const directoryLink = path.join(workspace, "directory-link");
    fs.symlinkSync(path.join(outside, "secret.txt"), fileLink, "file");
    fs.symlinkSync(
      outside,
      directoryLink,
      process.platform === "win32" ? "junction" : "dir"
    );

    const sensitiveSsh = path.join(workspace, ".ssh", "id_rsa");
    const sensitiveAws = path.join(workspace, ".aws", "credentials");
    fs.mkdirSync(path.dirname(sensitiveSsh), { recursive: true });
    fs.mkdirSync(path.dirname(sensitiveAws), { recursive: true });
    fs.writeFileSync(sensitiveSsh, "fixture-key\n");
    fs.writeFileSync(sensitiveAws, "fixture-credentials\n");

    const mockServer = path.resolve(
      process.cwd(),
      "dist/scripts/mock-mcp-server.js"
    );
    assert.ok(fs.existsSync(mockServer), `mock MCP server missing: ${mockServer}`);
    const proxyProjectA = path.join(workspace, "proxy-a");
    const proxyProjectB = path.join(workspace, "proxy-b");
    for (const project of [proxyProjectA, proxyProjectB]) {
      const configDirectory = path.join(project, ".gate-mcp");
      fs.mkdirSync(configDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(configDirectory, "proxy-servers.json"),
        JSON.stringify({
          servers: {
            mock: { command: process.execPath, args: [mockServer] },
          },
        })
      );
    }

    const tests: TestCase[] = [
      {
        name: "valid nested file",
        run: () => {
          const expected = fs.realpathSync.native(
            path.join(workspace, "nested", "valid.txt")
          );
          assert.equal(
            safeResolveExistingFile("nested/valid.txt", {
              caller: "security-regression",
            }),
            expected
          );
        },
      },
      {
        name: "symlink file escape",
        run: () => {
          expectRejected(
            () => safeResolveExistingFile(fileLink),
            /outside project boundary/
          );
        },
      },
      {
        name: "symlink directory escape",
        run: () => {
          expectRejected(
            () =>
              safeResolveExistingFile(path.join(directoryLink, "secret.txt")),
            /outside project boundary/
          );
        },
      },
      {
        name: "prefix-confusion sibling",
        run: () => {
          expectRejected(
            () =>
              safeResolveExistingFile(path.join(prefixSibling, "secret.txt")),
            /outside project boundary/
          );
        },
      },
      {
        name: "sensitive paths",
        run: () => {
          expectRejected(
            () => safeResolveExistingFile(sensitiveSsh),
            /sensitive path/
          );
          expectRejected(
            () => safeResolveExistingFile(sensitiveAws),
            /sensitive path/
          );
        },
      },
      {
        name: "non-existent database output",
        run: () => {
          const output = path.join(workspace, ".gate-mcp", "cache.db");
          const expected = path.join(
            fs.realpathSync.native(workspace),
            ".gate-mcp",
            "cache.db"
          );
          assert.equal(safeResolve(output), expected);
        },
      },
      {
        name: "non-existent output under symlink escape",
        run: () => {
          expectRejected(
            () => safeResolve(path.join(directoryLink, "future-cache.db")),
            /outside project boundary/
          );
        },
      },
      {
        name: "arbitrary projectRoot rejection",
        run: () => {
          expectRejected(
            () => resolveProjectRoot(outside),
            /outside project boundary/
          );
          expectRejected(
            () => safeResolve("secret.txt", { projectRoot: outside }),
            /outside project boundary/
          );
        },
      },
      {
        name: "dedup host-file rejection",
        run: async () => {
          await assert.rejects(
            handleDedupContext({
              action: "check",
              filePath: path.join(outside, "secret.txt"),
            }),
            /outside project boundary/
          );
          await assert.rejects(
            handleDedupContext({
              action: "store",
              filePath: path.join(outside, "secret.txt"),
              content: "untrusted cached content",
            }),
            /outside project boundary/
          );
        },
      },
      {
        name: "proxy disabled by default",
        run: async () => {
          await assert.rejects(
            getProxyConnection("mock", proxyProjectA),
            /Proxy execution is disabled by default/
          );
        },
      },
      {
        name: "proxy project isolation",
        run: async () => {
          process.env.GATE_ENABLE_PROXY = "1";
          const connectionA = await getProxyConnection("mock", proxyProjectA);
          const connectionB = await getProxyConnection("mock", proxyProjectB);
          assert.notEqual(
            connectionA,
            connectionB,
            "projects with the same server name reused one process"
          );
          const status = getProxyStatus().filter(
            (row) => row.server === "mock"
          );
          assert.deepEqual(
            new Set(status.map((row) => row.projectRoot)),
            new Set(
              [proxyProjectA, proxyProjectB].map((project) =>
                fs.realpathSync.native(project)
              )
            )
          );
        },
      },
      {
        name: "proxy invalid-root rejection after connection",
        run: async () => {
          await assert.rejects(
            getProxyConnection("mock", outside),
            /outside project boundary/
          );
        },
      },
    ];

    total = tests.length;
    for (const test of tests) {
      await test.run();
      passed++;
      process.stderr.write(`PASS ${test.name}\n`);
    }
  } finally {
    await closeAllProxies();
    restoreEnv("GATE_PROJECT_ROOT", previousRoot);
    restoreEnv("GATE_ALLOW_ANY_PATH", previousAllowAny);
    restoreEnv("GATE_ENABLE_PROXY", previousProxyExecution);
    fs.rmSync(fixtureBase, { recursive: true, force: true });
  }

  process.stderr.write(`Security regressions: ${passed}/${total} passed\n`);
}

void main().catch((error) => {
  process.stderr.write(
    `FAIL ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
