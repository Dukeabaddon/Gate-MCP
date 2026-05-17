/**
 * Optional graphify CLI integration (peer tool, not bundled).
 */

import { execSync } from "node:child_process";
import logger from "./logger.js";

let graphifyOnPath: boolean | null = null;

export function isGraphifyCliAvailable(): boolean {
  if (graphifyOnPath !== null) return graphifyOnPath;
  try {
    execSync("graphify --version", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    });
    graphifyOnPath = true;
  } catch {
    graphifyOnPath = false;
  }
  return graphifyOnPath;
}

export interface GraphifyUpdateResult {
  ok: boolean;
  workspaceRoot: string;
  message: string;
  stdout?: string;
}

/**
 * Run `graphify update .` in the directory that owns graphify-out/.
 */
export function runGraphifyUpdate(workspaceRoot: string): GraphifyUpdateResult {
  if (!isGraphifyCliAvailable()) {
    return {
      ok: false,
      workspaceRoot,
      message:
        "graphify CLI not on PATH. Install: pip install graphifyy — or run graphify update manually.",
    };
  }

  try {
    const stdout = execSync("graphify update .", {
      cwd: workspaceRoot,
      encoding: "utf8",
      timeout: 180_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    logger.info(`graphify update OK in ${workspaceRoot}`);
    return {
      ok: true,
      workspaceRoot,
      message: `graphify update completed in ${workspaceRoot}`,
      stdout: stdout.trim().slice(-500),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`graphify update failed: ${message}`);
    return { ok: false, workspaceRoot, message };
  }
}
