/**
 * Trusted project-root and Graphify report resolution.
 */

import fs from "node:fs";
import path from "node:path";
import {
  getAllowedProjectRoot,
  getActiveProjectRoot,
  isPathWithin,
  resolveProjectRoot,
  safeResolve,
  safeResolveExistingDirectory,
  safeResolveExistingFile,
} from "./pathGuard.js";

const MAX_WALK = 14;

/** Relative paths checked at each ancestor (nested graphify layouts). */
const GRAPHIFY_CANDIDATES = [
  "graphify-out/GRAPH_REPORT.md",
  "crypto/strategies/active/smc/graphify-out/GRAPH_REPORT.md",
];

/**
 * Walk upward from startDir without ever crossing the configured workspace.
 * Symlinked reports are canonicalized and rejected when they escape that root.
 */
export function findGraphifyReport(startDir: string): string | null {
  const allowedRoot = getAllowedProjectRoot();
  const startRoot = resolveProjectRoot(startDir, {
    caller: "findGraphifyReport",
  });

  const envPath = process.env.GATE_GRAPHIFY_REPORT?.trim();
  if (envPath) {
    const resolvedOverride = safeResolve(envPath, {
      caller: "findGraphifyReport",
    });
    if (fs.existsSync(resolvedOverride)) {
      return safeResolveExistingFile(resolvedOverride, {
        caller: "findGraphifyReport",
      });
    }
  }

  let dir = startRoot;
  for (let i = 0; i < MAX_WALK && isPathWithin(allowedRoot, dir); i++) {
    for (const rel of GRAPHIFY_CANDIDATES) {
      const candidate = path.join(dir, rel);
      if (fs.existsSync(candidate)) {
        return safeResolveExistingFile(candidate, {
          caller: "findGraphifyReport",
        });
      }
    }

    if (dir === allowedRoot) break;
    const parent = path.dirname(dir);
    if (parent === dir || !isPathWithin(allowedRoot, parent)) break;
    dir = parent;
  }
  return null;
}

/** Directory containing graphify-out (parent of graphify-out folder). */
export function graphifyWorkspaceRoot(reportPath: string): string {
  const report = safeResolveExistingFile(reportPath, {
    caller: "graphifyWorkspaceRoot",
  });
  return safeResolveExistingDirectory(path.dirname(path.dirname(report)), {
    caller: "graphifyWorkspaceRoot",
  });
}

/**
 * Resolve a code index root. Explicit tool arguments may narrow the configured
 * workspace root, but cannot widen it.
 */
export function resolveCodeRoot(explicit?: string): string {
  return resolveProjectRoot(explicit ?? getActiveProjectRoot(), {
    caller: "resolveCodeRoot",
  });
}
