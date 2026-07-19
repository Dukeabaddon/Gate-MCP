/**
 * Canonical path-boundary utilities.
 *
 * Local MCP servers inherit the user's filesystem permissions. Every path
 * accepted from a tool call must therefore remain under one trusted root:
 * GATE_PROJECT_ROOT when configured, otherwise the server's startup cwd.
 * Caller-supplied projectRoot values may narrow that boundary, never widen it.
 *
 * Set GATE_ALLOW_ANY_PATH=1 only for an explicitly trusted environment. Known
 * credential paths remain denied even when boundary enforcement is disabled.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import logger from "./logger.js";

const SENSITIVE_PATTERNS = [
  /(^|\/)\.ssh(\/|$)/,
  /(^|\/)\.gnupg(\/|$)/,
  /(^|\/)\.aws\/credentials$/,
  /(^|\/)\.netrc$/,
  /(^|\/)etc\/passwd$/,
  /(^|\/)etc\/shadow$/,
];

export interface SafePathOptions {
  /** A caller-supplied root that may narrow, but never widen, the boundary. */
  projectRoot?: string;
  /** Caller name for diagnostics. */
  caller?: string;
}

export interface ResolveProjectRootOptions {
  /** Caller name for diagnostics. */
  caller?: string;
}

interface ActiveProjectRoot {
  allowedRoot: string;
  projectRoot: string;
}

let activeProjectRoot: ActiveProjectRoot | null = null;

function boundaryDisabled(): boolean {
  return process.env.GATE_ALLOW_ANY_PATH === "1";
}

function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith(`~${path.sep}`) || input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

function requirePath(input: string, label = "Path"): string {
  if (!input || typeof input !== "string" || input.trim().length === 0) {
    throw new Error(`${label} argument must be a non-empty string`);
  }
  return input;
}

/**
 * Resolve symlinks for an existing path. For a not-yet-created output path,
 * resolve the nearest existing ancestor and append the missing components.
 * This prevents a symlinked parent directory from escaping the boundary.
 */
export function canonicalizePath(input: string): string {
  const absolute = path.resolve(expandHome(requirePath(input)));
  let existing = absolute;
  const missing: string[] = [];

  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) {
      throw new Error(`Unable to resolve an existing parent for: ${absolute}`);
    }
    missing.unshift(path.basename(existing));
    existing = parent;
  }

  const canonicalParent = fs.realpathSync.native(existing);
  return path.resolve(canonicalParent, ...missing);
}

function canonicalExistingDirectory(input: string, label: string): string {
  const canonical = canonicalizePath(input);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(canonical);
  } catch {
    throw new Error(`${label} does not exist: ${canonical}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`${label} is not a directory: ${canonical}`);
  }
  return canonical;
}

/** Cross-platform, component-aware containment. */
export function isPathWithin(boundary: string, candidate: string): boolean {
  const relative = path.relative(boundary, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

function normalizedForSensitiveCheck(candidate: string): string {
  return candidate.replaceAll("\\", "/").toLocaleLowerCase("en-US");
}

function assertNotSensitive(candidate: string): void {
  const normalized = normalizedForSensitiveCheck(candidate);
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(normalized)) {
      throw new Error(
        `Refused to access sensitive path: ${candidate}. ` +
          "Sensitive credential and system-account paths are always denied."
      );
    }
  }
}

function assertContained(candidate: string, boundary: string): void {
  if (!isPathWithin(boundary, candidate)) {
    throw new Error(
      `Path ${candidate} is outside project boundary ${boundary}. ` +
        "Set GATE_PROJECT_ROOT to the trusted workspace before server startup."
    );
  }
}

/**
 * Return the trusted workspace boundary. This value comes only from server
 * configuration, never a tool argument.
 */
export function getAllowedProjectRoot(): string {
  const configured = process.env.GATE_PROJECT_ROOT?.trim() || process.cwd();
  return canonicalExistingDirectory(configured, "Configured project root");
}

/**
 * Return the project selected by gate_init. The configured startup root remains
 * the immutable security boundary; an active root may only narrow it.
 */
export function getActiveProjectRoot(): string {
  const allowedRoot = getAllowedProjectRoot();
  const active = activeProjectRoot;
  if (!active || active.allowedRoot !== allowedRoot) return allowedRoot;

  try {
    const canonical = canonicalExistingDirectory(
      active.projectRoot,
      "Active project root"
    );
    if (boundaryDisabled() || isPathWithin(allowedRoot, canonical)) {
      return canonical;
    }
  } catch {
    // Fall back to the configured boundary when the active directory vanished.
  }
  activeProjectRoot = null;
  return allowedRoot;
}

/** Select the default root used by subsequent project-relative tool calls. */
export function activateProjectRoot(requested?: string): string {
  const allowedRoot = getAllowedProjectRoot();
  const projectRoot = resolveProjectRoot(requested, {
    caller: "gate_init",
  });
  activeProjectRoot = { allowedRoot, projectRoot };
  return projectRoot;
}

/**
 * Validate a caller-supplied projectRoot. Tool arguments may select the
 * configured root or a nested directory, but cannot select a sibling/parent.
 */
export function resolveProjectRoot(
  requested?: string,
  options: ResolveProjectRootOptions = {}
): string {
  const allowedRoot = getAllowedProjectRoot();
  const candidate = requested?.trim()
    ? canonicalExistingDirectory(
        path.isAbsolute(expandHome(requested.trim()))
          ? expandHome(requested.trim())
          : path.resolve(allowedRoot, expandHome(requested.trim())),
        "Project root"
      )
    : allowedRoot;

  assertNotSensitive(candidate);
  if (!boundaryDisabled()) {
    assertContained(candidate, allowedRoot);
  } else if (options.caller) {
    logger.warn(
      `[${options.caller}] boundary disabled (GATE_ALLOW_ANY_PATH=1): ${candidate}`
    );
  }
  return candidate;
}

/**
 * Resolve a path and verify its canonical target remains within the effective
 * project root. Non-existent outputs are checked through their nearest
 * existing canonical parent.
 */
export function safeResolve(
  userPath: string,
  opts: SafePathOptions = {}
): string {
  const effectiveRoot = resolveProjectRoot(opts.projectRoot, {
    caller: opts.caller,
  });
  const expanded = expandHome(requirePath(userPath));
  const unresolved = path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(effectiveRoot, expanded);
  const canonical = canonicalizePath(unresolved);

  assertNotSensitive(canonical);
  if (!boundaryDisabled()) {
    assertContained(canonical, effectiveRoot);
  } else if (opts.caller) {
    logger.warn(
      `[${opts.caller}] boundary disabled (GATE_ALLOW_ANY_PATH=1): ${canonical}`
    );
  }
  return canonical;
}

/** Resolve a guarded path and require an existing regular file. */
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
  if (!stat.isFile()) {
    throw new Error(`Path is not a regular file: ${resolved}`);
  }
  return resolved;
}

/** Resolve a guarded path and require an existing directory. */
export function safeResolveExistingDirectory(
  userPath: string,
  opts: SafePathOptions = {}
): string {
  const resolved = safeResolve(userPath, opts);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Directory not found: ${resolved}`);
  }
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${resolved}`);
  }
  return resolved;
}
