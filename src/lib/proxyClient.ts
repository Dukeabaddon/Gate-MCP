/**
 * Proxy Client Manager.
 *
 * Spawns and maintains stdio MCP client connections to downstream MCP
 * servers configured in `.gate-mcp/proxy-servers.json`. Used by the
 * `gate_proxy_tools` and `gate_proxy_call` tools to act as a token-saving
 * gateway over the user's existing MCP server roster.
 *
 * Connection model:
 *   - Lazy: each downstream server is only spawned the first time it is
 *     referenced. Subsequent calls reuse the live transport.
 *   - Cached: connections survive across tool calls within a session.
 *   - Cleaned up on graceful shutdown (see closeAllProxies()).
 *
 * Why this design:
 *   The whole point of proxy mode is to amortize MCP server overhead.
 *   Re-spawning a server for every call would defeat the purpose — it
 *   would add 50-500ms of startup latency per call and re-incur the
 *   tool-listing schema cost the LLM is trying to avoid.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  ListToolsResult,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs";
import path from "node:path";
import logger from "./logger.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ProxyServerConfig {
  /** Executable to spawn (typically "npx" or "node"). */
  command: string;
  /** Arguments passed to the executable. */
  args?: string[];
  /** Optional environment variables for the spawned process. */
  env?: Record<string, string>;
  /** Optional human-readable description (surfaced in catalogs). */
  description?: string;
  /** When true, suppresses this server from gate_proxy_tools output. */
  disabled?: boolean;
}

export interface ProxyConfig {
  /** Map of server-name -> server config. */
  servers: Record<string, ProxyServerConfig>;
}

interface LiveConnection {
  client: Client;
  transport: StdioClientTransport;
  tools?: ListToolsResult["tools"];
  connectedAt: number;
}

// ─── State ──────────────────────────────────────────────────────────────────

/** Live connection pool keyed by server name. */
const connections = new Map<string, LiveConnection>();

/** In-flight connection attempts (prevents double-spawn races). */
const pendingConnects = new Map<string, Promise<LiveConnection>>();

// ─── Config loading ─────────────────────────────────────────────────────────

/**
 * Resolve the path to the proxy config file. Honors GATE_PROXY_CONFIG override.
 */
export function getProxyConfigPath(projectRoot?: string): string {
  const override = process.env.GATE_PROXY_CONFIG;
  if (override && override.length > 0) {
    return path.resolve(override);
  }
  const root = projectRoot ?? process.env.GATE_PROJECT_ROOT ?? process.cwd();
  return path.join(root, ".gate-mcp", "proxy-servers.json");
}

/**
 * Read and validate the proxy config file. Returns an empty config if the
 * file is missing — proxy mode is strictly opt-in.
 */
export function loadProxyConfig(projectRoot?: string): ProxyConfig {
  const configPath = getProxyConfigPath(projectRoot);
  if (!fs.existsSync(configPath)) {
    return { servers: {} };
  }
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    throw new Error(
      `Failed to read proxy config at ${configPath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Proxy config at ${configPath} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return validateProxyConfig(parsed, configPath);
}

function validateProxyConfig(parsed: unknown, configPath: string): ProxyConfig {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Proxy config at ${configPath} must be a JSON object`);
  }
  const obj = parsed as Record<string, unknown>;
  const serversRaw = obj.servers;
  if (!serversRaw || typeof serversRaw !== "object" || Array.isArray(serversRaw)) {
    throw new Error(
      `Proxy config at ${configPath} must contain a "servers" object`
    );
  }
  const servers: Record<string, ProxyServerConfig> = {};
  for (const [name, value] of Object.entries(serversRaw)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(
        `Proxy config entry "${name}" must be an object with a "command" field`
      );
    }
    const v = value as Record<string, unknown>;
    if (typeof v.command !== "string" || v.command.length === 0) {
      throw new Error(
        `Proxy config entry "${name}" is missing required "command" field`
      );
    }
    servers[name] = {
      command: v.command,
      args: Array.isArray(v.args) ? (v.args as string[]) : [],
      env:
        v.env && typeof v.env === "object" && !Array.isArray(v.env)
          ? (v.env as Record<string, string>)
          : undefined,
      description: typeof v.description === "string" ? v.description : undefined,
      disabled: v.disabled === true,
    };
  }
  return { servers };
}

// ─── Connection lifecycle ───────────────────────────────────────────────────

/**
 * Return a live connection for the named server, spawning it if necessary.
 * Concurrent callers asking for the same server share a single spawn promise.
 */
export async function getProxyConnection(
  serverName: string,
  projectRoot?: string
): Promise<LiveConnection> {
  const existing = connections.get(serverName);
  if (existing) return existing;
  const pending = pendingConnects.get(serverName);
  if (pending) return pending;

  const config = loadProxyConfig(projectRoot);
  const serverCfg = config.servers[serverName];
  if (!serverCfg) {
    throw new Error(
      `Proxy server "${serverName}" not found in proxy config. ` +
        `Add it under "servers" in ${getProxyConfigPath(projectRoot)}.`
    );
  }
  if (serverCfg.disabled) {
    throw new Error(`Proxy server "${serverName}" is marked disabled in config`);
  }

  const promise = spawnAndConnect(serverName, serverCfg);
  pendingConnects.set(serverName, promise);
  try {
    const conn = await promise;
    connections.set(serverName, conn);
    return conn;
  } finally {
    pendingConnects.delete(serverName);
  }
}

async function spawnAndConnect(
  serverName: string,
  cfg: ProxyServerConfig
): Promise<LiveConnection> {
  const startedAt = Date.now();
  logger.info(
    `[proxy] spawning downstream MCP server "${serverName}" (${cfg.command} ${(cfg.args ?? []).join(" ")})`
  );

  // StdioClientTransport requires env as Record<string, string>. Inherit the
  // parent env unless the user supplied an explicit override, otherwise tools
  // like npx will fail to find HOME / PATH / Node binaries.
  const mergedEnv: Record<string, string> = { ...(process.env as Record<string, string>) };
  if (cfg.env) {
    for (const [k, v] of Object.entries(cfg.env)) {
      mergedEnv[k] = v;
    }
  }

  const transport = new StdioClientTransport({
    command: cfg.command,
    args: cfg.args ?? [],
    env: mergedEnv,
    // Server errors surface as JSON-RPC errors via the Client — no need for
    // a separate stderr handler.
  });

  const client = new Client(
    { name: "gatemcp-proxy", version: "0.5.0" },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);
  } catch (err) {
    // Clean up the half-opened transport so we don't leak a child process.
    try {
      await transport.close();
    } catch {
      // ignore secondary cleanup failures
    }
    throw new Error(
      `Failed to connect to downstream MCP server "${serverName}": ${err instanceof Error ? err.message : String(err)}`
    );
  }

  logger.info(
    `[proxy] connected to "${serverName}" in ${Date.now() - startedAt}ms`
  );
  return { client, transport, connectedAt: Date.now() };
}

/**
 * List tools exposed by the downstream server. Cached per connection so we
 * don't re-pay the listTools cost on every gate_proxy_tools call.
 */
export async function listProxyTools(
  serverName: string,
  projectRoot?: string,
  forceRefresh = false
): Promise<ListToolsResult["tools"]> {
  const conn = await getProxyConnection(serverName, projectRoot);
  if (!forceRefresh && conn.tools) return conn.tools;
  const result = await conn.client.listTools();
  conn.tools = result.tools;
  return result.tools;
}

/**
 * Default per-call timeout. Downstream MCP servers that hang would otherwise
 * block gate_proxy_call indefinitely (StdioClientTransport has no built-in
 * timeout). Override per-call via the timeoutMs argument or globally via the
 * GATE_PROXY_TIMEOUT_MS env var. 0 disables the timeout.
 */
const DEFAULT_CALL_TIMEOUT_MS = (() => {
  const raw = process.env.GATE_PROXY_TIMEOUT_MS;
  if (raw === undefined) return 30_000;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 30_000;
})();

/**
 * Forward a tool invocation to the downstream server and return its raw result.
 * Response compression is the caller's responsibility (proxyTools.ts uses
 * gate_clean_response under the hood).
 *
 * Wraps the call in a Promise.race against a timer so a hung downstream
 * server cannot starve the parent gatemcp process. On timeout we drop the
 * cached connection so the next call gets a fresh spawn.
 */
export async function callProxyTool(
  serverName: string,
  toolName: string,
  args: Record<string, unknown> | undefined,
  projectRoot?: string,
  timeoutMs?: number
): Promise<CallToolResult> {
  const effectiveTimeout =
    timeoutMs !== undefined ? timeoutMs : DEFAULT_CALL_TIMEOUT_MS;

  const conn = await getProxyConnection(serverName, projectRoot);

  const callPromise = conn.client.callTool({
    name: toolName,
    arguments: args ?? {},
  });

  if (effectiveTimeout <= 0) {
    return (await callPromise) as CallToolResult;
  }

  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `Downstream MCP call ${serverName}.${toolName} timed out after ` +
            `${effectiveTimeout}ms (override with GATE_PROXY_TIMEOUT_MS or ` +
            `gate_proxy_call timeoutMs argument)`
        )
      );
    }, effectiveTimeout);
  });

  try {
    const result = await Promise.race([callPromise, timeoutPromise]);
    return result as CallToolResult;
  } catch (err) {
    // On timeout, the downstream server may be wedged. Drop the cached
    // connection so the NEXT call gets a fresh spawn. Cleanup is fire-and-
    // forget so the caller (LLM) gets the timeout error immediately instead
    // of waiting another 1-3s for the wedged process to actually die.
    const isTimeout =
      err instanceof Error && err.message.includes("timed out after");
    if (isTimeout) {
      logger.warn(
        `[proxy] dropping wedged connection to "${serverName}" after timeout (cleanup async)`
      );
      // Capture the connection ref BEFORE removing from the live pool so we
      // can still call close() on the spawned child. Removal first means
      // concurrent callers won't grab the wedged connection while cleanup runs.
      const wedged = connections.get(serverName);
      connections.delete(serverName);
      if (wedged) {
        void Promise.allSettled([
          wedged.client.close(),
          wedged.transport.close(),
        ]).then((results) => {
          for (const r of results) {
            if (r.status === "rejected") {
              logger.warn(
                `[proxy] async cleanup of wedged "${serverName}" failed: ${r.reason}`
              );
            }
          }
        });
      }
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Close a single downstream connection. Safe to call on a server that was
 * never connected (no-op).
 */
export async function closeProxyConnection(serverName: string): Promise<void> {
  const conn = connections.get(serverName);
  if (!conn) return;
  connections.delete(serverName);
  try {
    await conn.client.close();
  } catch (err) {
    logger.warn(`[proxy] error closing client "${serverName}": ${err}`);
  }
  try {
    await conn.transport.close();
  } catch (err) {
    logger.warn(`[proxy] error closing transport "${serverName}": ${err}`);
  }
}

/**
 * Close every active downstream connection. Wired into the server's graceful
 * shutdown so we don't leave orphaned child processes when gatemcp exits.
 */
export async function closeAllProxies(): Promise<void> {
  const names = Array.from(connections.keys());
  if (names.length === 0) return;
  logger.info(`[proxy] closing ${names.length} downstream connection(s)`);
  await Promise.all(names.map((name) => closeProxyConnection(name)));
}

/**
 * Diagnostic snapshot of currently open proxy connections. Used by
 * gate_proxy_tools status mode.
 */
export function getProxyStatus(): Array<{
  server: string;
  connectedAt: number;
  toolsCached: number;
}> {
  return Array.from(connections.entries()).map(([server, conn]) => ({
    server,
    connectedAt: conn.connectedAt,
    toolsCached: conn.tools?.length ?? 0,
  }));
}
