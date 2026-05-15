/**
 * gate_memory — Cross-session JSON persistence.
 *
 * Lightweight key-value store using a JSON file in the project root.
 * Enables agents to persist context (decisions, preferences, findings)
 * across MCP sessions without external databases.
 *
 * Storage: .gate-mcp/memory.json in the project root.
 */

import fs from "node:fs";
import path from "node:path";
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
  note: string;
}

const MEMORY_DIR = ".gate-mcp";
const MEMORY_FILE = "memory.json";

/**
 * Get the memory file path for a project.
 */
function getMemoryPath(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), MEMORY_DIR, MEMORY_FILE);
}

/**
 * Load the memory store from disk.
 */
function loadMemory(memoryPath: string): Record<string, string> {
  try {
    if (fs.existsSync(memoryPath)) {
      const raw = fs.readFileSync(memoryPath, "utf-8");
      return JSON.parse(raw) as Record<string, string>;
    }
  } catch (err) {
    logger.warn(`Failed to load memory: ${err}`);
  }
  return {};
}

/**
 * Save the memory store to disk.
 */
function saveMemory(
  memoryPath: string,
  store: Record<string, string>
): void {
  const dir = path.dirname(memoryPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(memoryPath, JSON.stringify(store, null, 2), "utf-8");
}

/**
 * Handle a memory operation.
 */
export async function handleMemory(args: MemoryInput): Promise<MemoryResult> {
  const { action, key, value, projectRoot = process.cwd() } = args;
  const memoryPath = getMemoryPath(projectRoot);
  const store = loadMemory(memoryPath);

  switch (action) {
    case "read": {
      const stored = store[key];
      if (stored !== undefined) {
        logger.info(`Memory READ: "${key}" → ${stored.length} chars`);
        return {
          action: "read",
          key,
          value: stored,
          entries: Object.keys(store).length,
          note: `Found "${key}" (${stored.length} chars). ${Object.keys(store).length} total entries.`,
        };
      }
      return {
        action: "read",
        key,
        entries: Object.keys(store).length,
        note: `Key "${key}" not found. ${Object.keys(store).length} total entries.`,
      };
    }

    case "write": {
      if (!value) {
        return {
          action: "write",
          key,
          note: "Error: value is required for write action.",
        };
      }
      store[key] = value;
      saveMemory(memoryPath, store);
      logger.info(`Memory WRITE: "${key}" (${value.length} chars)`);
      return {
        action: "write",
        key,
        value,
        entries: Object.keys(store).length,
        note: `Stored "${key}" (${value.length} chars). ${Object.keys(store).length} total entries. Persisted to ${MEMORY_DIR}/${MEMORY_FILE}.`,
      };
    }

    case "delete": {
      if (key in store) {
        delete store[key];
        saveMemory(memoryPath, store);
        logger.info(`Memory DELETE: "${key}"`);
        return {
          action: "delete",
          key,
          entries: Object.keys(store).length,
          note: `Deleted "${key}". ${Object.keys(store).length} entries remaining.`,
        };
      }
      return {
        action: "delete",
        key,
        entries: Object.keys(store).length,
        note: `Key "${key}" not found. Nothing deleted.`,
      };
    }

    case "list": {
      const keys = Object.keys(store);
      const summary = keys
        .slice(0, 25)
        .map((k) => `${k}: ${store[k].length} chars`)
        .join("\n");
      const listValue =
        keys.length === 0
          ? "(empty)"
          : summary + (keys.length > 25 ? `\n... +${keys.length - 25} more` : "");
      logger.info(`Memory LIST: ${keys.length} entries`);
      return {
        action: "list",
        key: "*",
        value: listValue,
        entries: keys.length,
        note: `${keys.length} entries stored in ${MEMORY_DIR}/${MEMORY_FILE}.`,
      };
    }

    case "clear": {
      const count = Object.keys(store).length;
      saveMemory(memoryPath, {});
      logger.info(`Memory CLEAR: removed ${count} entries`);
      return {
        action: "clear",
        key: "*",
        entries: 0,
        note: `Cleared ${count} entries from memory.`,
      };
    }

    default:
      return {
        action: String(action),
        key,
        note: `Unknown action "${action}". Use: read, write, delete, list, clear.`,
      };
  }
}
// Last reviewed: 2026-05-15 — verified against v0.3.2 fidelity test suite.
