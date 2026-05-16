/**
 * Proxy Tools — gate_proxy_tools + gate_proxy_call.
 *
 * Lets the LLM treat gatemcp as a single MCP endpoint that fronts every
 * other MCP server the user has configured in `.gate-mcp/proxy-servers.json`.
 *
 * Why this matters for token cost:
 *   Most MCP-aware IDEs ship every server's tool catalog into the LLM
 *   context window on every turn. With 10 servers averaging 5 tools and
 *   ~600 tokens of schema each, that is 30,000 tokens of static schema
 *   overhead PER turn. By proxying through gatemcp we compress the
 *   catalog to ~5,000 tokens (TOON tabular form + truncated descriptions)
 *   and we can lazily expand a tool's full schema only when the LLM
 *   actually intends to call it.
 *
 * Two tools are exposed:
 *
 *   gate_proxy_tools
 *     Modes: list | describe | status | refresh
 *     Returns a compressed catalog of downstream tools.
 *
 *   gate_proxy_call
 *     Forwards a tool invocation to the named downstream server and
 *     pipes the response through the same TOON-based compressor that
 *     powers gate_clean_response so the LLM never sees raw bloat.
 */

import {
  loadProxyConfig,
  listProxyTools,
  callProxyTool,
  getProxyStatus,
  closeProxyConnection,
} from "../lib/proxyClient.js";
import { handleCleanResponse } from "./cleanResponse.js";
import { countTextTokens } from "../lib/tokenCounter.js";
import logger from "../lib/logger.js";

// ─── gate_proxy_tools ───────────────────────────────────────────────────────

export type ProxyToolsAction = "list" | "describe" | "status" | "refresh";

export interface ProxyToolsInput {
  action: ProxyToolsAction;
  /** Required for action="describe" or filtering action="list". */
  server?: string;
  /** Required for action="describe". */
  tool?: string;
  /** Limit list output to the first N tools per server (default 999). */
  maxPerServer?: number;
  /** Optional override of the project root used to locate the proxy config. */
  projectRoot?: string;
}

export interface ProxyToolsResult {
  action: ProxyToolsAction;
  servers?: Array<{
    name: string;
    description?: string;
    toolCount: number;
    disabled?: boolean;
  }>;
  tools?: Array<{
    server: string;
    name: string;
    summary: string;
    params: string;
  }>;
  describe?: {
    server: string;
    name: string;
    description: string;
    inputSchema: unknown;
  };
  status?: Array<{
    server: string;
    connectedSecondsAgo: number;
    toolsCached: number;
  }>;
  tokenCost: {
    /** Approximation of what the raw downstream catalog would cost. */
    rawEstimate: number;
    /** Actual size of the response gatemcp is returning to the LLM. */
    compressed: number;
    savingsPercent: number;
  };
  note: string;
}

/**
 * Handle a gate_proxy_tools call.
 */
export async function handleProxyTools(
  args: ProxyToolsInput
): Promise<ProxyToolsResult> {
  const { action, server, tool, maxPerServer = 999, projectRoot } = args;

  if (action === "status") {
    return buildStatusResult();
  }

  const config = loadProxyConfig(projectRoot);
  const allServerNames = Object.keys(config.servers).filter(
    (n) => !config.servers[n].disabled
  );

  if (allServerNames.length === 0) {
    const empty: ProxyToolsResult = {
      action,
      servers: [],
      tokenCost: { rawEstimate: 0, compressed: 0, savingsPercent: 0 },
      note:
        "No proxy servers configured. Create .gate-mcp/proxy-servers.json " +
        "with a 'servers' map (same shape as your IDE's MCP config).",
    };
    return empty;
  }

  if (action === "refresh") {
    // Drop any cached connections so the next listProxyTools call re-spawns
    // them with fresh tool catalogs. Useful when a downstream server has
    // hot-reloaded its tool registry.
    await Promise.all(allServerNames.map((s) => closeProxyConnection(s)));
    logger.info(`[proxy] refreshed ${allServerNames.length} server(s)`);
  }

  if (action === "describe") {
    if (!server || !tool) {
      throw new Error(
        "action='describe' requires both 'server' and 'tool' arguments"
      );
    }
    const tools = await listProxyTools(server, projectRoot);
    const match = tools.find((t) => t.name === tool);
    if (!match) {
      throw new Error(
        `Tool "${tool}" not found on server "${server}". ` +
          `Available: ${tools.map((t) => t.name).join(", ")}`
      );
    }
    const payload = {
      server,
      name: match.name,
      description: match.description ?? "",
      inputSchema: match.inputSchema ?? {},
    };
    const serialized = JSON.stringify(payload);
    return {
      action,
      describe: payload,
      tokenCost: {
        rawEstimate: countTextTokens(serialized),
        compressed: countTextTokens(serialized),
        savingsPercent: 0,
      },
      note: `Full schema for ${server}.${match.name} (uncompressed — needed for accurate calls).`,
    };
  }

  // action === "list" or "refresh" (which also returns the list)
  const targetServers = server ? [server] : allServerNames;
  const flatTools: ProxyToolsResult["tools"] = [];
  let rawCatalogEstimate = 0;

  for (const srv of targetServers) {
    let tools;
    try {
      tools = await listProxyTools(srv, projectRoot);
    } catch (err) {
      logger.warn(
        `[proxy] failed to list tools from "${srv}": ${err instanceof Error ? err.message : String(err)}`
      );
      // Keep going — one broken downstream server should not poison the catalog.
      continue;
    }
    const slice = tools.slice(0, maxPerServer);
    for (const t of slice) {
      const fullDescription = t.description ?? "";
      const fullSchema = JSON.stringify(t.inputSchema ?? {});
      // Token cost the LLM would pay without proxy mode.
      rawCatalogEstimate +=
        countTextTokens(t.name) +
        countTextTokens(fullDescription) +
        countTextTokens(fullSchema) +
        10; // JSON-RPC envelope overhead
      flatTools.push({
        server: srv,
        name: t.name,
        summary: abbreviateDescription(fullDescription),
        params: abbreviateSchema(t.inputSchema),
      });
    }
  }

  const serversSummary = allServerNames.map((name) => ({
    name,
    description: config.servers[name].description,
    toolCount: flatTools.filter((t) => t.server === name).length,
    disabled: config.servers[name].disabled,
  }));

  const result: ProxyToolsResult = {
    action,
    servers: serversSummary,
    tools: flatTools,
    tokenCost: {
      rawEstimate: rawCatalogEstimate,
      compressed: 0, // filled in after serialization
      savingsPercent: 0,
    },
    note:
      `Compressed catalog of ${flatTools.length} tool(s) across ` +
      `${serversSummary.length} downstream server(s). ` +
      `Call gate_proxy_tools with action='describe', server, tool to get a full schema before invoking, ` +
      `then use gate_proxy_call to invoke.`,
  };

  const serialized = JSON.stringify(result);
  result.tokenCost.compressed = countTextTokens(serialized);
  result.tokenCost.savingsPercent =
    rawCatalogEstimate > 0
      ? Math.max(
          0,
          Math.round(
            ((rawCatalogEstimate - result.tokenCost.compressed) /
              rawCatalogEstimate) *
              100
          )
        )
      : 0;

  logger.info(
    `gate_proxy_tools: ${flatTools.length} tools across ${serversSummary.length} servers, ` +
      `${rawCatalogEstimate} → ${result.tokenCost.compressed} tokens ` +
      `(${result.tokenCost.savingsPercent}% saved)`
  );

  return result;
}

function buildStatusResult(): ProxyToolsResult {
  const status = getProxyStatus();
  const now = Date.now();
  const rows = status.map((s) => ({
    server: s.server,
    connectedSecondsAgo: Math.round((now - s.connectedAt) / 1000),
    toolsCached: s.toolsCached,
  }));
  const serialized = JSON.stringify(rows);
  return {
    action: "status",
    status: rows,
    tokenCost: {
      rawEstimate: countTextTokens(serialized),
      compressed: countTextTokens(serialized),
      savingsPercent: 0,
    },
    note: `${rows.length} downstream connection(s) currently open.`,
  };
}

// ─── gate_proxy_call ────────────────────────────────────────────────────────

export interface ProxyCallInput {
  /** Name of the downstream server (must exist in proxy-servers.json). */
  server: string;
  /** Tool name on the downstream server. */
  tool: string;
  /** Arguments forwarded to the downstream tool. */
  args?: Record<string, unknown>;
  /** Compression format for the response. Defaults to "toon". */
  format?: "toon" | "compact" | "whitelist" | "raw";
  /** Whitelisted fields when format="whitelist". */
  whitelist?: string[];
  /** Maximum array items before truncation in the compressed response. */
  maxArrayItems?: number;
  /** Optional project-root override for config lookup. */
  projectRoot?: string;
  /** Per-call timeout in ms. 0 disables. Defaults to GATE_PROXY_TIMEOUT_MS or 30000. */
  timeoutMs?: number;
}

export interface ProxyCallResult {
  server: string;
  tool: string;
  isError: boolean;
  response: string;
  tokenCost: {
    rawResponseTokens: number;
    compressedTokens: number;
    savingsPercent: number;
  };
  format: string;
  note: string;
}

/**
 * Handle a gate_proxy_call invocation.
 *
 * The downstream MCP server returns content blocks (text / image / resource).
 * For text blocks we concatenate them, attempt JSON parse, and run through
 * the same compressor as gate_clean_response. Non-text blocks are passed
 * through untouched (they are typically already compact references).
 */
export async function handleProxyCall(
  args: ProxyCallInput
): Promise<ProxyCallResult> {
  const {
    server,
    tool,
    args: toolArgs,
    format = "toon",
    whitelist,
    maxArrayItems = 50,
    projectRoot,
    timeoutMs,
  } = args;

  if (!server || !tool) {
    throw new Error("gate_proxy_call requires both 'server' and 'tool' arguments");
  }

  const startedAt = Date.now();
  const callResult = await callProxyTool(
    server,
    tool,
    toolArgs,
    projectRoot,
    timeoutMs
  );
  const elapsedMs = Date.now() - startedAt;

  // Aggregate text content into a single string we can compress.
  const textParts: string[] = [];
  const nonTextParts: unknown[] = [];
  for (const block of callResult.content ?? []) {
    if (block && typeof block === "object" && (block as { type?: string }).type === "text") {
      textParts.push((block as { text?: string }).text ?? "");
    } else {
      nonTextParts.push(block);
    }
  }
  const rawText = textParts.join("\n");
  const rawTokens =
    countTextTokens(rawText) +
    nonTextParts.reduce<number>(
      (acc, part) => acc + countTextTokens(JSON.stringify(part)),
      0
    );

  let compressed = rawText;
  let appliedFormat: string = format;

  if (format !== "raw" && rawText.length > 0) {
    // Only compress JSON-like responses. If the downstream tool returned
    // free-form prose, compression would harm readability without helping
    // much, so we leave it alone.
    if (looksLikeJson(rawText)) {
      try {
        const cleaned = await handleCleanResponse({
          data: rawText,
          format,
          whitelist,
          maxArrayItems,
        });
        compressed = cleaned.cleaned;
        appliedFormat = cleaned.format;
      } catch (err) {
        logger.warn(
          `[proxy] compression of ${server}.${tool} response failed, returning raw: ${err}`
        );
        appliedFormat = "raw-fallback";
      }
    } else {
      appliedFormat = "raw-nonjson";
    }
  } else if (format === "raw") {
    appliedFormat = "raw";
  }

  // Re-attach non-text blocks (rare — most MCP tools only emit text).
  let merged = compressed;
  if (nonTextParts.length > 0) {
    merged += "\n\n[non-text blocks]\n" + JSON.stringify(nonTextParts);
  }

  const compressedTokens = countTextTokens(merged);
  const savings =
    rawTokens > 0
      ? Math.max(
          0,
          Math.round(((rawTokens - compressedTokens) / rawTokens) * 100)
        )
      : 0;

  logger.info(
    `gate_proxy_call ${server}.${tool} (${elapsedMs}ms): ` +
      `${rawTokens} → ${compressedTokens} tokens (${savings}% saved, format=${appliedFormat})`
  );

  return {
    server,
    tool,
    isError: callResult.isError === true,
    response: merged,
    tokenCost: {
      rawResponseTokens: rawTokens,
      compressedTokens,
      savingsPercent: savings,
    },
    format: appliedFormat,
    note:
      `Proxied ${server}.${tool} in ${elapsedMs}ms. ` +
      `${rawTokens} → ${compressedTokens} tokens (${savings}% saved).`,
  };
}

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Trim a tool description to its first sentence (or 140 chars max) so the
 * catalog stays scannable. The LLM can always pull the full description via
 * action='describe'.
 */
function abbreviateDescription(desc: string): string {
  if (!desc) return "";
  const trimmed = desc.replace(/\s+/g, " ").trim();
  // Cut at first period (but not inside e.g. abbreviations like "e.g.")
  const firstPeriod = trimmed.search(/\.(\s|$)/);
  let candidate =
    firstPeriod !== -1 && firstPeriod < 200
      ? trimmed.slice(0, firstPeriod + 1)
      : trimmed;
  if (candidate.length > 140) candidate = candidate.slice(0, 137) + "...";
  return candidate;
}

/**
 * Render a JSON Schema as a comma-separated list of required-or-typed params.
 * Example: "owner:str, repo:str, [labels:str[]]" — square brackets denote
 * optional fields. LLMs can parse this in ~10 tokens instead of the 200+
 * a full JSON Schema would cost.
 */
function abbreviateSchema(schema: unknown): string {
  if (!schema || typeof schema !== "object") return "";
  const s = schema as { properties?: Record<string, unknown>; required?: string[] };
  const props = s.properties ?? {};
  const required = new Set(s.required ?? []);
  const parts: string[] = [];
  for (const [name, def] of Object.entries(props)) {
    const typeStr = renderTypeHint(def);
    const piece = `${name}:${typeStr}`;
    parts.push(required.has(name) ? piece : `[${piece}]`);
  }
  return parts.join(", ");
}

function renderTypeHint(def: unknown): string {
  if (!def || typeof def !== "object") return "any";
  const d = def as {
    type?: string | string[];
    enum?: unknown[];
    items?: unknown;
  };
  if (d.enum && Array.isArray(d.enum)) {
    // Cap enum rendering so absurd enums (1000 options) don't blow up the catalog
    const opts = d.enum.slice(0, 5).map(String).join("|");
    return d.enum.length > 5 ? `${opts}|…` : opts;
  }
  if (Array.isArray(d.type)) return d.type.join("|");
  if (d.type === "array") {
    const inner = renderTypeHint(d.items);
    return `${inner}[]`;
  }
  if (typeof d.type === "string") {
    switch (d.type) {
      case "string":
        return "str";
      case "integer":
        return "int";
      case "number":
        return "num";
      case "boolean":
        return "bool";
      case "object":
        return "obj";
      default:
        return d.type;
    }
  }
  return "any";
}

function looksLikeJson(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed.length === 0) return false;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  return (
    (first === "{" && last === "}") ||
    (first === "[" && last === "]")
  );
}
