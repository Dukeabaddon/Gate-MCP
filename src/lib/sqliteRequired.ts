/**
 * Fail fast when better-sqlite3 cannot be loaded.
 * Escape hatch: GATE_ALLOW_MEMORY_CACHE=1 (tests / emergency only).
 */

import { createRequire } from "node:module";
import logger from "./logger.js";

const require = createRequire(import.meta.url);

export function sqliteModuleAvailable(): boolean {
  try {
    require("better-sqlite3");
    return true;
  } catch {
    return false;
  }
}

export function assertSqliteModuleOrExit(): void {
  if (process.env.GATE_ALLOW_MEMORY_CACHE === "1") {
    logger.warn(
      "GATE_ALLOW_MEMORY_CACHE=1 — SQLite module check skipped (memory fallback allowed)"
    );
    return;
  }
  if (sqliteModuleAvailable()) return;

  const msg =
    "better-sqlite3 is required but could not be loaded. " +
    "Reinstall with npm allow-scripts for better-sqlite3 (see README Installation), " +
    "or set GATE_ALLOW_MEMORY_CACHE=1 only for emergency/testing.";
  logger.error(msg);
  throw new Error(msg);
}
