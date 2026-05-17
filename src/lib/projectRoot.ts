/**
 * Resolve project / graphify paths for gate_graph_query.
 */

import fs from "node:fs";
import path from "node:path";

const MAX_WALK = 14;

/** Relative paths checked at each ancestor (nested graphify layouts). */
const GRAPHIFY_CANDIDATES = [
  "graphify-out/GRAPH_REPORT.md",
  "crypto/strategies/active/smc/graphify-out/GRAPH_REPORT.md",
];

/**
 * Walk upward from startDir; return absolute path to GRAPH_REPORT.md if found.
 */
export function findGraphifyReport(startDir: string): string | null {
  const envPath = process.env.GATE_GRAPHIFY_REPORT?.trim();
  if (envPath && fs.existsSync(envPath)) return path.resolve(envPath);

  let dir = path.resolve(startDir);
  for (let i = 0; i < MAX_WALK; i++) {
    for (const rel of GRAPHIFY_CANDIDATES) {
      const candidate = path.join(dir, rel);
      if (fs.existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Directory containing graphify-out (parent of graphify-out folder).
 */
export function graphifyWorkspaceRoot(reportPath: string): string {
  return path.dirname(path.dirname(reportPath));
}

/**
 * Resolve code index root: explicit arg > GATE_PROJECT_ROOT > cwd.
 */
export function resolveCodeRoot(explicit?: string): string {
  if (explicit?.trim()) return path.resolve(explicit.trim());
  const env = process.env.GATE_PROJECT_ROOT?.trim();
  if (env) return path.resolve(env);
  return path.resolve(process.cwd());
}
