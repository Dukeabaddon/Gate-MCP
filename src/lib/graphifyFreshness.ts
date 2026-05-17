/**
 * Detect stale graphify-out/GRAPH_REPORT.md vs current git HEAD.
 */

import fs from "node:fs";
import { execSync } from "node:child_process";

export interface GraphifyBuildMeta {
  builtCommit?: string;
  builtDate?: string;
}

export function parseGraphifyBuildMeta(reportText: string): GraphifyBuildMeta {
  const builtCommit =
    reportText.match(/Built from commit:\s*`?([0-9a-f]{7,40})`?/i)?.[1] ??
    reportText.match(/commit[:\s]+`?([0-9a-f]{7,40})`?/i)?.[1];
  const builtDate = reportText.match(/^#\s*Graph Report[^)]*\(([^)]+)\)/m)?.[1]?.trim();
  return { builtCommit, builtDate };
}

export function getCurrentGitHead(codeRoot: string): string | null {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: codeRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function commitsMatch(a: string, b: string): boolean {
  const na = a.toLowerCase();
  const nb = b.toLowerCase();
  return na === nb || na.startsWith(nb) || nb.startsWith(na);
}

/**
 * Returns a warning string when GRAPH_REPORT commit differs from git HEAD.
 */
export function graphifyStaleWarning(codeRoot: string, reportPath: string): string | null {
  let text: string;
  try {
    text = fs.readFileSync(reportPath, "utf8");
  } catch {
    return null;
  }

  const { builtCommit } = parseGraphifyBuildMeta(text);
  if (!builtCommit) return null;

  const head = getCurrentGitHead(codeRoot);
  if (!head) return null;
  if (commitsMatch(builtCommit, head)) return null;

  return (
    `Graphify report may be stale (built ${builtCommit.slice(0, 7)}, ` +
    `HEAD ${head.slice(0, 7)}). Run \`graphify update .\` in ${codeRoot}.`
  );
}
