/**
 * GATE_TOOL_MODE — schema-surface control (see ARCHITECTURE.md).
 *
 * catalog (default): small tools/list + gate_invoke for the long tail
 * full: every tool registered (legacy / debugging)
 */

export type ToolMode = "catalog" | "full";

/** Tools always present in catalog mode (hot path + discovery). */
export const CATALOG_CORE_TOOLS = [
  "gate_help",
  "gate_init",
  "gate_compress_file",
  "gate_graph_query",
  "gate_session_stats",
  "gate_invoke",
] as const;

export type CatalogCoreTool = (typeof CATALOG_CORE_TOOLS)[number];

/** Every invokable Gate tool name (excluding gate_invoke itself). */
export const ALL_GATE_TOOLS = [
  "gate_optimize_image",
  "gate_compress_file",
  "gate_graph_query",
  "gate_memory",
  "gate_dedup_context",
  "gate_clean_response",
  "gate_proxy_tools",
  "gate_proxy_call",
  "gate_validate_compression",
  "gate_init",
  "gate_session_stats",
  "gate_help",
] as const;

export type GateToolName = (typeof ALL_GATE_TOOLS)[number];

export function resolveToolMode(
  env: NodeJS.ProcessEnv = process.env
): ToolMode {
  const raw = (env.GATE_TOOL_MODE ?? "catalog").trim().toLowerCase();
  if (raw === "full") return "full";
  if (raw === "catalog" || raw === "") return "catalog";
  // Unknown values fall back to catalog (safer default for schema budget).
  return "catalog";
}

export function shouldRegisterTool(
  toolName: string,
  mode: ToolMode = resolveToolMode()
): boolean {
  if (mode === "full") {
    // gate_invoke is catalog-only (avoid redundant schema in full mode).
    return toolName !== "gate_invoke";
  }
  return (CATALOG_CORE_TOOLS as readonly string[]).includes(toolName);
}
