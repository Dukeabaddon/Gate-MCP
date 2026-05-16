/**
 * gate_memory — Cross-session key-value persistence.
 *
 * v0.5.2: SQLite table in `.gate-mcp/cache.db` (shared with dedup cache, WAL)
 * when better-sqlite3 loads. Falls back to `.gate-mcp/memory.json` otherwise.
 * Existing memory.json is migrated once into SQLite on first open.
 */

import {
  isMemoryPersistent,
  memoryBackendLabel,
  memoryClear,
  memoryCount,
  memoryDelete,
  memoryGet,
  memoryList,
  memoryPut,
} from "../lib/memoryDb.js";
import logger from "../lib/logger.js";

export type MemoryAction = "read" | "write" | "delete" | "list" | "clear";

export interface MemoryInput {
  action: MemoryAction;
  key: string;
  value?: string;
  projectRoot?: string;
}

export interface MemoryResult {
  action: string;
  key: string;
  value?: string;
  entries?: number;
  backend?: string;
  note: string;
}

function storageHint(projectRoot: string): string {
  return isMemoryPersistent(projectRoot)
    ? "SQLite (.gate-mcp/cache.db, memory_entries)"
    : ".gate-mcp/memory.json";
}

/**
 * Handle a memory operation.
 */
export async function handleMemory(args: MemoryInput): Promise<MemoryResult> {
  const { action, key, value, projectRoot = process.cwd() } = args;
  const backend = memoryBackendLabel(projectRoot);

  switch (action) {
    case "read": {
      const stored = memoryGet(projectRoot, key);
      const count = memoryCount(projectRoot);
      if (stored !== undefined) {
        logger.info(`Memory READ: "${key}" → ${stored.length} chars (${backend})`);
        return {
          action: "read",
          key,
          value: stored,
          entries: count,
          backend,
          note: `Found "${key}" (${stored.length} chars). ${count} total entries. Backend: ${storageHint(projectRoot)}.`,
        };
      }
      return {
        action: "read",
        key,
        entries: count,
        backend,
        note: `Key "${key}" not found. ${count} total entries. Backend: ${storageHint(projectRoot)}.`,
      };
    }

    case "write": {
      if (!value) {
        return {
          action: "write",
          key,
          backend,
          note: "Error: value is required for write action.",
        };
      }
      const count = memoryPut(projectRoot, key, value);
      logger.info(`Memory WRITE: "${key}" (${value.length} chars, ${backend})`);
      return {
        action: "write",
        key,
        value,
        entries: count,
        backend,
        note: `Stored "${key}" (${value.length} chars). ${count} total entries. Backend: ${storageHint(projectRoot)}.`,
      };
    }

    case "delete": {
      const { deleted, count } = memoryDelete(projectRoot, key);
      if (deleted) {
        logger.info(`Memory DELETE: "${key}"`);
        return {
          action: "delete",
          key,
          entries: count,
          backend,
          note: `Deleted "${key}". ${count} entries remaining.`,
        };
      }
      return {
        action: "delete",
        key,
        entries: count,
        backend,
        note: `Key "${key}" not found. Nothing deleted.`,
      };
    }

    case "list": {
      const rows = memoryList(projectRoot);
      const summary = rows
        .slice(0, 25)
        .map((r) => `${r.key}: ${r.length} chars`)
        .join("\n");
      const listValue =
        rows.length === 0
          ? "(empty)"
          : summary +
            (rows.length > 25 ? `\n... +${rows.length - 25} more` : "");
      logger.info(`Memory LIST: ${rows.length} entries (${backend})`);
      return {
        action: "list",
        key: "*",
        value: listValue,
        entries: rows.length,
        backend,
        note: `${rows.length} entries. Backend: ${storageHint(projectRoot)}.`,
      };
    }

    case "clear": {
      const removed = memoryClear(projectRoot);
      logger.info(`Memory CLEAR: removed ${removed} entries`);
      return {
        action: "clear",
        key: "*",
        entries: 0,
        backend,
        note: `Cleared ${removed} entries from memory.`,
      };
    }

    default:
      return {
        action: String(action),
        key,
        backend,
        note: `Unknown action "${action}". Use: read, write, delete, list, clear.`,
      };
  }
}
