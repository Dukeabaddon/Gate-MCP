#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const CACHE_MARKER = ".gatemcp-plugin-cache-v1";
const MAX_CAPTURED_STDERR = 128 * 1024;
const STARTUP_LOCK_TIMEOUT_MS = 120_000;
const STARTUP_LOCK_STALE_MS = 300_000;

function cacheRoot() {
  const override = process.env.GATE_PLUGIN_NPM_CACHE?.trim();
  if (override) return path.resolve(override);

  const base =
    process.env.XDG_CACHE_HOME?.trim() ||
    process.env.LOCALAPPDATA?.trim() ||
    path.join(os.homedir(), ".cache");
  return path.resolve(base, "gatemcp", "plugin-npm");
}

function prepareOwnedCache(root) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const marker = path.join(root, CACHE_MARKER);
  if (!fs.existsSync(marker)) {
    const entries = fs.readdirSync(root);
    if (entries.length > 0) {
      throw new Error(
        `Refusing non-empty unowned npm cache: ${root}. ` +
          "Set GATE_PLUGIN_NPM_CACHE to an empty Gate-owned directory.",
      );
    }
    fs.writeFileSync(
      marker,
      "Gate MCP plugin-owned npm cache. Its _npx directory may be rebuilt.\n",
      { mode: 0o600 },
    );
  }
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function startupLockIsStale(lockPath) {
  try {
    const owner = JSON.parse(
      fs.readFileSync(path.join(lockPath, "owner.json"), "utf8"),
    );
    const age = Date.now() - Number(owner.startedAt || 0);
    return age > STARTUP_LOCK_STALE_MS || !processIsAlive(Number(owner.pid));
  } catch {
    try {
      return Date.now() - fs.statSync(lockPath).mtimeMs > STARTUP_LOCK_STALE_MS;
    } catch {
      return false;
    }
  }
}

async function acquireStartupLock(root) {
  const lockPath = path.join(root, ".startup-lock");
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const deadline = Date.now() + STARTUP_LOCK_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      fs.mkdirSync(lockPath, { mode: 0o700 });
      fs.writeFileSync(
        path.join(lockPath, "owner.json"),
        JSON.stringify({ pid: process.pid, startedAt: Date.now(), token }),
        { mode: 0o600 },
      );
      let released = false;
      return () => {
        if (released) return;
        released = true;
        try {
          const owner = JSON.parse(
            fs.readFileSync(path.join(lockPath, "owner.json"), "utf8"),
          );
          if (owner.token === token) {
            fs.rmSync(lockPath, { recursive: true, force: true });
          }
        } catch {
          // A stale-lock recovery may already have removed it.
        }
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (startupLockIsStale(lockPath)) {
        fs.rmSync(lockPath, { recursive: true, force: true });
        process.stderr.write(
          "[gatemcp launcher] Removed a stale startup cache lock.\n",
        );
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Timed out waiting for another Gate npm cache startup.");
}

function isIncompleteExecEntry(entryPath) {
  const packageJson = path.join(entryPath, "package.json");
  const nodeModules = path.join(entryPath, "node_modules");
  const packageLock = path.join(entryPath, "package-lock.json");
  if (!fs.existsSync(nodeModules) && !fs.existsSync(packageLock)) return false;
  if (!fs.existsSync(packageJson)) return true;

  try {
    const parsed = JSON.parse(fs.readFileSync(packageJson, "utf8"));
    return !parsed || typeof parsed !== "object" || Array.isArray(parsed);
  } catch {
    return true;
  }
}

function repairIncompleteExecEntries(root) {
  const execRoot = path.join(root, "_npx");
  if (!fs.existsSync(execRoot)) return 0;

  let repaired = 0;
  for (const entry of fs.readdirSync(execRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const entryPath = path.join(execRoot, entry.name);
    if (!isIncompleteExecEntry(entryPath)) continue;
    fs.rmSync(entryPath, { recursive: true, force: true });
    repaired += 1;
  }
  return repaired;
}

function isNpmExecCacheFailure(stderr) {
  return (
    /\bENOENT\b/i.test(stderr) &&
    /(?:^|[/\\])_npx(?:[/\\]|$)/i.test(stderr) &&
    /package\.json/i.test(stderr)
  );
}

function npmEnvironment(root) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === "npm_config_cache") delete env[key];
  }
  env.npm_config_cache = root;
  env.npm_config_update_notifier = "false";
  return env;
}

function npmCommand() {
  const command =
    process.env.GATE_PLUGIN_NPM_COMMAND?.trim() ||
    (process.platform === "win32" ? "npm.cmd" : "npm");
  const rawPrefix = process.env.GATE_PLUGIN_NPM_COMMAND_ARGS_JSON?.trim();
  if (!rawPrefix) return { command, prefixArgs: [] };

  const prefixArgs = JSON.parse(rawPrefix);
  if (
    !Array.isArray(prefixArgs) ||
    !prefixArgs.every((arg) => typeof arg === "string")
  ) {
    throw new Error("GATE_PLUGIN_NPM_COMMAND_ARGS_JSON must be a JSON string array.");
  }
  return { command, prefixArgs };
}

function runNpmExec(root, npmArgs, onReady) {
  const { command, prefixArgs } = npmCommand();

  return new Promise((resolve, reject) => {
    const child = spawn(command, [...prefixArgs, "exec", ...npmArgs], {
      env: npmEnvironment(root),
      stdio: ["inherit", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdoutBytes = 0;
    let stderr = "";
    let ready = false;

    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (!ready) {
        ready = true;
        onReady();
      }
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      stderr = (stderr + chunk.toString("utf8")).slice(-MAX_CAPTURED_STDERR);
    });

    const signalHandlers = new Map();
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      const handler = () => child.kill(signal);
      signalHandlers.set(signal, handler);
      process.once(signal, handler);
    }
    const removeSignalHandlers = () => {
      for (const [signal, handler] of signalHandlers) {
        process.removeListener(signal, handler);
      }
    };

    child.once("error", (error) => {
      removeSignalHandlers();
      reject(error);
    });
    child.once("exit", (code, signal) => {
      removeSignalHandlers();
      resolve({ code, signal, stderr, stdoutBytes });
    });
  });
}

async function main() {
  const npmArgs = process.argv.slice(2);
  if (!npmArgs.some((arg) => arg.startsWith("--package=") && arg.length > 10)) {
    throw new Error("Gate launcher requires an explicit package specification.");
  }
  if (npmArgs.slice(-2).join(" ") !== "-- gatemcp") {
    throw new Error("Gate launcher requires the gatemcp binary after '--'.");
  }

  const root = cacheRoot();
  prepareOwnedCache(root);
  const releaseStartupLock = await acquireStartupLock(root);
  try {
    const repaired = repairIncompleteExecEntries(root);
    if (repaired > 0) {
      process.stderr.write(
        `[gatemcp launcher] Repaired ${repaired} incomplete npm exec cache entr${
          repaired === 1 ? "y" : "ies"
        }.\n`,
      );
    }

    let result = await runNpmExec(root, npmArgs, releaseStartupLock);
    if (
      result.code !== 0 &&
      result.stdoutBytes === 0 &&
      isNpmExecCacheFailure(result.stderr)
    ) {
      process.stderr.write(
        "[gatemcp launcher] npm exec cache was incomplete; rebuilding it once.\n",
      );
      fs.rmSync(path.join(root, "_npx"), { recursive: true, force: true });
      result = await runNpmExec(root, npmArgs, releaseStartupLock);
    }

    if (result.signal) {
      process.kill(process.pid, result.signal);
      return;
    }
    process.exitCode = result.code ?? 1;
  } finally {
    releaseStartupLock();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[gatemcp launcher] ${message}\n`);
  process.exitCode = 1;
});
