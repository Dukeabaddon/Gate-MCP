/** End-to-end installation diagnostics for `gatemcp doctor`. */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { cacheBackendInfo, getStats, isPersistent } from "./lib/cacheDb.js";
import { resolveCodeRoot } from "./lib/projectRoot.js";
import { safeResolve } from "./lib/pathGuard.js";
import { GATEMCP_VERSION } from "./version.js";

const require = createRequire(import.meta.url);

export type DoctorStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  detail: string;
}

export interface DoctorReport {
  ok: boolean;
  strict: boolean;
  version: string;
  projectRoot: string;
  expectedTools: string[];
  discoveredTools: string[];
  checks: DoctorCheck[];
}

const EXPECTED_TOOLS = [
  "gate_init",
  "gate_graph_query",
  "gate_compress_file",
  "gate_session_stats",
  "gate_help",
  "gate_invoke",
];

/** Long-tail tools that must stay hidden in default catalog mode. */
const CATALOG_HIDDEN_TOOLS = [
  "gate_memory",
  "gate_dedup_context",
  "gate_clean_response",
  "gate_proxy_tools",
  "gate_proxy_call",
  "gate_validate_compression",
  "gate_optimize_image",
];

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function probeSqlite(projectRoot: string): string {
  const Database = require("better-sqlite3") as typeof import("better-sqlite3");
  const probePath = safeResolve(
    path.join(
      projectRoot,
      ".gate-mcp",
      `doctor-${process.pid}-${Date.now()}.db`
    ),
    { projectRoot, caller: "doctor" }
  );
  fs.mkdirSync(path.dirname(probePath), { recursive: true });
  let db: import("better-sqlite3").Database | undefined;
  const marker = `${process.pid}-${Date.now()}`;
  try {
    db = new Database(probePath);
    db.pragma("journal_mode = WAL");
    db.exec("CREATE TABLE probe(value TEXT NOT NULL)");
    db.prepare("INSERT INTO probe(value) VALUES(?)").run(marker);
    db.close();
    db = undefined;

    const reopened = new Database(probePath, { readonly: true });
    const row = reopened.prepare("SELECT value FROM probe").get() as
      | { value: string }
      | undefined;
    reopened.close();
    if (row?.value !== marker) throw new Error("SQLite reopen verification failed");
    return probePath;
  } finally {
    try {
      db?.close();
    } catch {
      // Cleanup continues after a failed close.
    }
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        fs.unlinkSync(`${probePath}${suffix}`);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    }
  }
}

export async function runDoctor(options: {
  projectRoot?: string;
  serverEntrypoint: string;
  timeoutMs?: number;
  strict?: boolean;
}): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const discoveredTools: string[] = [];
  const timeoutMs = options.timeoutMs ?? 10_000;
  const strict = options.strict ?? false;
  let projectRoot: string;
  try {
    projectRoot = resolveCodeRoot(options.projectRoot);
  } catch (err) {
    projectRoot = options.projectRoot ?? "(unresolved)";
    checks.push({ name: "project_root", status: "fail", detail: message(err) });
  }

  try {
    fs.accessSync(process.execPath, fs.constants.X_OK);
    fs.accessSync(options.serverEntrypoint, fs.constants.R_OK);
    checks.push({
      name: "server_executable",
      status: "pass",
      detail: `${process.execPath} ${options.serverEntrypoint}`,
    });
  } catch (err) {
    checks.push({
      name: "server_executable",
      status: "fail",
      detail: message(err),
    });
  }

  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const requiredPackages = [
    "@modelcontextprotocol/sdk/server/mcp.js",
    "better-sqlite3",
    "gpt-tokenizer",
    "sharp",
    "tesseract.js",
    "tree-sitter",
    "tree-sitter-json",
    "zod",
  ];
  const missingPackages = requiredPackages.filter((dependency) => {
    try {
      require.resolve(dependency);
      return false;
    } catch {
      return true;
    }
  });
  checks.push({
    name: "dependencies",
    status: nodeMajor >= 20 && missingPackages.length === 0 ? "pass" : "fail",
    detail:
      nodeMajor < 20
        ? `Node ${process.versions.node}; Node >=20 required`
        : missingPackages.length > 0
          ? `missing: ${missingPackages.join(", ")}`
          : `Node ${process.versions.node}; required packages resolved`,
  });

  if (!checks.some((check) => check.name === "project_root")) {
    try {
      const stat = fs.statSync(projectRoot);
      if (!stat.isDirectory()) throw new Error("project root is not a directory");
      fs.accessSync(projectRoot, fs.constants.R_OK);
      checks.push({
        name: "project_root",
        status: "pass",
        detail: projectRoot,
      });
    } catch (err) {
      checks.push({ name: "project_root", status: "fail", detail: message(err) });
    }
  }

  try {
    fs.accessSync(projectRoot, fs.constants.R_OK | fs.constants.W_OK);
    checks.push({
      name: "repository_permissions",
      status: "pass",
      detail: "read and write access available",
    });
  } catch (err) {
    checks.push({
      name: "repository_permissions",
      status: "fail",
      detail: message(err),
    });
  }

  const projectRootReady = checks.some(
    (check) => check.name === "project_root" && check.status === "pass"
  );
  if (!projectRootReady) {
    checks.push({
      name: "cache_access",
      status: "fail",
      detail: "not checked because project_root is invalid",
    });
  } else {
    try {
      const persistent = isPersistent(projectRoot);
      const stats = getStats(projectRoot);
      const backend = cacheBackendInfo(projectRoot);
      if (persistent) {
        fs.accessSync(
          path.dirname(backend.path),
          fs.constants.R_OK | fs.constants.W_OK
        );
        probeSqlite(projectRoot);
      }
      checks.push({
        name: "cache_access",
        status: persistent ? "pass" : strict ? "fail" : "warn",
        detail: persistent
          ? `SQLite write/reopen probe passed at ${backend.path}; ${stats.totalEntries} entries`
          : `in-memory fallback active: ${backend.fallbackReason ?? "unknown reason"}`,
      });
    } catch (err) {
      checks.push({ name: "cache_access", status: "fail", detail: message(err) });
    }
  }

  checks.push({
    name: "proxy_execution_policy",
    status: "pass",
    detail:
      process.env.GATE_ENABLE_PROXY === "1"
        ? "enabled explicitly; review .gate-mcp/proxy-servers.json commands"
        : "disabled by default; set GATE_ENABLE_PROXY=1 after reviewing config",
  });

  const memoryEscape = process.env.GATE_ALLOW_MEMORY_CACHE === "1";
  checks.push({
    name: "memory_cache_policy",
    status: memoryEscape ? (strict ? "fail" : "warn") : "pass",
    detail: memoryEscape
      ? "GATE_ALLOW_MEMORY_CACHE=1 is set (SQLite fail-closed disabled; emergency/testing only)"
      : "GATE_ALLOW_MEMORY_CACHE unset; SQLite required and memory fallback refused",
  });

  checks.push({
    name: "large_file_limit",
    status: "pass",
    detail: `GATE_MAX_FILE_BYTES=${process.env.GATE_MAX_FILE_BYTES ?? 32 * 1024 * 1024}`,
  });

  let transport: StdioClientTransport | undefined;
  let client: Client | undefined;
  try {
    const childEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      GATE_PROJECT_ROOT: projectRoot,
      DISABLE_CONSOLE_OUTPUT: "true",
      // Doctor always validates the default catalog surface, even if the
      // parent shell exported GATE_TOOL_MODE=full.
      GATE_TOOL_MODE: "catalog",
    };
    // Do not inherit the memory escape hatch into the doctor MCP child —
    // otherwise a parent GATE_ALLOW_MEMORY_CACHE=1 makes a non-strict doctor
    // PASS while the default product policy is bypassed.
    delete childEnv.GATE_ALLOW_MEMORY_CACHE;

    transport = new StdioClientTransport({
      command: process.execPath,
      args: [options.serverEntrypoint],
      env: childEnv,
    });
    client = new Client(
      { name: "gatemcp-doctor", version: GATEMCP_VERSION },
      { capabilities: {} }
    );
    await withTimeout(client.connect(transport), timeoutMs);
    checks.push({
      name: "mcp_initialize",
      status: "pass",
      detail: "initialize handshake completed",
    });

    const listed = await withTimeout(client.listTools(), timeoutMs);
    discoveredTools.push(...listed.tools.map((tool) => tool.name).sort());
    const missingTools = EXPECTED_TOOLS.filter(
      (tool) => !discoveredTools.includes(tool)
    );
    const leakedTools = CATALOG_HIDDEN_TOOLS.filter((tool) =>
      discoveredTools.includes(tool)
    );
    checks.push({
      name: "tools_list",
      status:
        missingTools.length === 0 && leakedTools.length === 0 ? "pass" : "fail",
      detail:
        missingTools.length === 0 && leakedTools.length === 0
          ? `${discoveredTools.length} catalog tools discovered; long-tail hidden`
          : [
              missingTools.length
                ? `missing required tools: ${missingTools.join(", ")}`
                : null,
              leakedTools.length
                ? `catalog leak (must use gate_invoke): ${leakedTools.join(", ")}`
                : null,
            ]
              .filter(Boolean)
              .join("; "),
    });
  } catch (err) {
    if (!checks.some((check) => check.name === "mcp_initialize")) {
      checks.push({
        name: "mcp_initialize",
        status: "fail",
        detail: message(err),
      });
    } else {
      checks.push({ name: "tools_list", status: "fail", detail: message(err) });
    }
  } finally {
    if (client) {
      try {
        await client.close();
      } catch {
        // The transport may already be closed after a failed handshake.
      }
    } else if (transport) {
      try {
        await transport.close();
      } catch {
        // Best-effort child cleanup.
      }
    }
  }

  return {
    ok: !checks.some((check) => check.status === "fail"),
    strict,
    version: GATEMCP_VERSION,
    projectRoot,
    expectedTools: EXPECTED_TOOLS,
    discoveredTools,
    checks,
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = [
    `gatemcp doctor v${report.version}${report.strict ? " --strict" : ""}`,
  ];
  for (const check of report.checks) {
    lines.push(`${check.status.toUpperCase()} ${check.name}: ${check.detail}`);
  }
  lines.push(report.ok ? "PASS Gate MCP is runnable." : "FAIL Gate MCP needs attention.");
  return lines.join("\n");
}
