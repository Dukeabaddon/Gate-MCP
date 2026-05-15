/**
 * Path guard utilities.
 *
 * Prevents path-traversal and limits file access to a configurable
 * project-root boundary. Local MCP servers run with the user's full
 * permissions — without a boundary, a malicious or hallucinating LLM
 * caller could request `/etc/passwd` or `~/.ssh/id_rsa`.
 *
 * Boundary precedence (highest to lowest):
 *   1. Explicit `projectRoot` argument
 *   2. GATE_PROJECT_ROOT env var
 *   3. process.cwd() (default)
 *
 * Disable boundary entirely: set GATE_ALLOW_ANY_PATH=1 (not recommended).
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import logger from "./logger.js";

/** Files outside the boundary will throw unless this is true. */
const BOUNDARY_DISABLED = process.env.GATE_ALLOW_ANY_PATH === "1";

/** Paths explicitly denied even when they fall inside the boundary. */
const SENSITIVE_PATTERNS = [
  /\/\.ssh\//,
  /\/\.gnupg\//,
  /\/\.aws\/credentials/,
  /\/\.netrc$/,
  /\/etc\/passwd$/,
  /\/etc\/shadow$/,
];

export interface SafePathOptions {
  /** Override the project-root boundary explicitly. */
  projectRoot?: string;
  /** Caller name for log messages. */
  caller?: string;
}

/**
 * Resolve a user-supplied path to an absolute path and verify it falls
 * within the configured project-root boundary. Throws on violation.
 */
export function safeResolve(
  userPath: string,
  opts: SafePathOptions = {}
): string {
  if (!userPath || typeof userPath !== "string") {
    throw new Error("Path argument must be a non-empty string");
  }

  // Expand ~ to home directory
  let expanded = userPath;
  if (expanded.startsWith("~")) {
    expanded = path.join(os.homedir(), expanded.slice(1));
  }

  const boundary = path.resolve(
    opts.projectRoot ?? process.env.GATE_PROJECT_ROOT ?? process.cwd()
  );

  const resolved = path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(boundary, expanded);

  // Block known-sensitive locations regardless of boundary
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(resolved)) {
      throw new Error(
        `Refused to access sensitive path: ${resolved}. ` +
          `Set GATE_ALLOW_ANY_PATH=1 only if you understand the risk.`
      );
    }
  }

  // Boundary check
  if (!BOUNDARY_DISABLED) {
    const withinBoundary =
      resolved === boundary || resolved.startsWith(boundary + path.sep);
    if (!withinBoundary) {
      throw new Error(
        `Path ${resolved} is outside project boundary ${boundary}. ` +
          `Set GATE_PROJECT_ROOT or pass projectRoot to widen scope, ` +
          `or set GATE_ALLOW_ANY_PATH=1 to disable.`
      );
    }
  } else if (opts.caller) {
    logger.warn(
      `[${opts.caller}] boundary disabled (GATE_ALLOW_ANY_PATH=1): ${resolved}`
    );
  }

  return resolved;
}

/**
 * Resolve and verify a path AND verify the file exists.
 * Useful for tool handlers that need to read files.
 */
export function safeResolveExistingFile(
  userPath: string,
  opts: SafePathOptions = {}
): string {
  const resolved = safeResolve(userPath, opts);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) {
    throw new Error(`Path is a directory, not a file: ${resolved}`);
  }
  return resolved;
}
