/**
 * TOON (Token-Optimized Object Notation) Converter.
 *
 * Converts verbose JSON responses into compact tabular format
 * to reduce token consumption by 30-98%.
 *
 * Standard JSON repeats keys for every object in an array.
 * TOON declares headers once, then uses rows — like CSV but LLM-readable.
 *
 * Example:
 *   JSON: [{"id":1,"name":"Alice"},{"id":2,"name":"Bob"}]  (22 tokens)
 *   TOON: id|name\n1|Alice\n2|Bob                          (8 tokens)
 */

import { countTextTokens } from "../lib/tokenCounter.js";
import logger from "../lib/logger.js";

export interface CleanResponseInput {
  data: string; // raw JSON string
  format?: "toon" | "compact" | "whitelist";
  whitelist?: string[]; // fields to keep (whitelist mode)
  maxArrayItems?: number; // truncate large arrays
}

export interface CleanResponseResult {
  original: string;
  cleaned: string;
  format: string;
  originalTokens: number;
  optimizedTokens: number;
  savingsPercent: number;
  note: string;
}

/**
 * Clean/compress a JSON response using TOON notation or field whitelisting.
 */
export async function handleCleanResponse(
  args: CleanResponseInput
): Promise<CleanResponseResult> {
  const { data, format = "toon", whitelist, maxArrayItems = 50 } = args;

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return {
      original: data,
      cleaned: data,
      format: "passthrough",
      originalTokens: countTextTokens(data),
      optimizedTokens: countTextTokens(data),
      savingsPercent: 0,
      note: "Input is not valid JSON — returned as-is.",
    };
  }

  const originalTokens = countTextTokens(data);
  let cleaned: string;

  switch (format) {
    case "toon":
      cleaned = toToon(parsed, maxArrayItems);
      break;
    case "compact":
      cleaned = toCompact(parsed);
      break;
    case "whitelist":
      cleaned = toWhitelist(parsed, whitelist ?? [], maxArrayItems);
      break;
    default:
      cleaned = toToon(parsed, maxArrayItems);
  }

  const optimizedTokens = countTextTokens(cleaned);
  const savingsPercent =
    originalTokens > 0
      ? Math.round(((originalTokens - optimizedTokens) / originalTokens) * 100)
      : 0;

  logger.info(
    `gate_clean_response: ${originalTokens} → ${optimizedTokens} tokens (${savingsPercent}% saved, format=${format})`
  );

  return {
    original: data.length > 200 ? data.slice(0, 200) + "..." : data,
    cleaned,
    format,
    originalTokens,
    optimizedTokens,
    savingsPercent,
    note: `Compressed JSON using ${format} format. ${originalTokens} → ${optimizedTokens} tokens (${savingsPercent}% saved).`,
  };
}

// ─── TOON Notation ──────────────────────────────────────────────────────────

/**
 * Convert JSON to TOON (Token-Optimized Object Notation).
 * Arrays of objects → header row + data rows (pipe-delimited).
 * Other structures → compact JSON.
 */
function toToon(data: unknown, maxItems: number): string {
  // Array of uniform objects → tabular TOON
  if (Array.isArray(data) && data.length > 0 && isUniformObjectArray(data)) {
    return arrayToToon(data, maxItems);
  }

  // Object with array values → each array becomes a TOON table
  if (isPlainObject(data)) {
    const obj = data as Record<string, unknown>;
    const sections: string[] = [];

    for (const [key, value] of Object.entries(obj)) {
      if (
        Array.isArray(value) &&
        value.length > 0 &&
        isUniformObjectArray(value)
      ) {
        sections.push(`[${key}]`);
        sections.push(arrayToToon(value, maxItems));
        sections.push("");
      } else if (isPlainObject(value)) {
        sections.push(`[${key}]`);
        sections.push(objectToKeyValue(value as Record<string, unknown>));
        sections.push("");
      } else {
        sections.push(`${key}: ${primitiveToString(value)}`);
      }
    }

    return sections.join("\n").trim();
  }

  // Fallback: compact JSON
  return toCompact(data);
}

/**
 * Convert an array of uniform objects to TOON tabular format.
 */
function arrayToToon(
  arr: Record<string, unknown>[],
  maxItems: number
): string {
  const items = arr.slice(0, maxItems);
  const keys = Object.keys(items[0]);
  const lines: string[] = [];

  // Header row
  lines.push(keys.join("|"));

  // Data rows
  for (const item of items) {
    const values = keys.map((k) => primitiveToString(item[k]));
    lines.push(values.join("|"));
  }

  if (arr.length > maxItems) {
    lines.push(`... +${arr.length - maxItems} more`);
  }

  return lines.join("\n");
}

/**
 * Convert an object to key: value lines.
 */
function objectToKeyValue(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .map(([k, v]) => `${k}: ${primitiveToString(v)}`)
    .join("\n");
}

// ─── Compact JSON ───────────────────────────────────────────────────────────

/**
 * Minimize JSON by removing whitespace and truncating deep nesting.
 */
function toCompact(data: unknown): string {
  return JSON.stringify(data, null, 0);
}

// ─── Whitelist Mode ─────────────────────────────────────────────────────────

/**
 * Keep only whitelisted fields from objects.
 */
function toWhitelist(
  data: unknown,
  fields: string[],
  maxItems: number
): string {
  if (fields.length === 0) {
    return toToon(data, maxItems);
  }

  const fieldSet = new Set(fields);

  if (Array.isArray(data)) {
    const filtered = data.slice(0, maxItems).map((item) => {
      if (isPlainObject(item)) {
        return filterFields(item as Record<string, unknown>, fieldSet);
      }
      return item;
    });
    return toToon(filtered, maxItems);
  }

  if (isPlainObject(data)) {
    const filtered = filterFields(data as Record<string, unknown>, fieldSet);
    return toToon(filtered, maxItems);
  }

  return toCompact(data);
}

function filterFields(
  obj: Record<string, unknown>,
  fields: Set<string>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (fields.has(key)) {
      result[key] = value;
    }
  }
  return result;
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUniformObjectArray(arr: unknown[]): boolean {
  if (!isPlainObject(arr[0])) return false;
  const keys = Object.keys(arr[0] as Record<string, unknown>)
    .sort()
    .join(",");
  // Check first 5 items for uniformity
  for (let i = 1; i < Math.min(arr.length, 5); i++) {
    if (!isPlainObject(arr[i])) return false;
    const itemKeys = Object.keys(arr[i] as Record<string, unknown>)
      .sort()
      .join(",");
    if (itemKeys !== keys) return false;
  }
  return true;
}

function primitiveToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length <= 3) return value.map(primitiveToString).join(",");
    return `[${value.length} items]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value as Record<string, unknown>);
    return `{${keys.length} fields}`;
  }
  return String(value);
}
