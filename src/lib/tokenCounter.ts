/**
 * Token counting utilities for Gate-MCP.
 *
 * Image token estimation follows the OpenAI high-detail / low-detail tile model.
 * Text token counting uses gpt-tokenizer for accurate BPE encoding.
 */

import { encode } from "gpt-tokenizer";
import type { TokenMetrics } from "../types.js";

/**
 * Estimate image token cost based on pixel dimensions.
 *
 * High-detail: The image is tiled into 512×512 chunks. Each tile ≈ 170 tokens.
 * Approximation: (width × height) / 750
 *
 * Low-detail: A single 512×512 tile costs ~85 tokens.
 * Approximation: (width × height) / 1500
 */
export function estimateImageTokens(
  width: number,
  height: number,
  detail: "high" | "low" = "high"
): number {
  if (width <= 0 || height <= 0) return 0;
  const divisor = detail === "high" ? 750 : 1500;
  return Math.ceil((width * height) / divisor);
}

/**
 * Count text tokens using gpt-tokenizer BPE encoding.
 */
export function countTextTokens(text: string): number {
  if (!text || text.trim().length === 0) return 0;
  return encode(text).length;
}

/**
 * Calculate savings metrics from original and optimized token counts.
 * Never reports positive savings when optimized > original.
 */
export function calculateSavings(
  originalTokens: number,
  optimizedTokens: number
): TokenMetrics {
  const expanded = optimizedTokens > originalTokens;
  const rawPercent =
    originalTokens > 0
      ? Math.round(((originalTokens - optimizedTokens) / originalTokens) * 100)
      : 0;

  return {
    originalTokens,
    optimizedTokens,
    savingsPercent: expanded ? 0 : Math.max(0, rawPercent),
    expanded,
  };
}

/** Human-readable note for compress/graph tools. */
export function formatSavingsNote(metrics: TokenMetrics, detail: string): string {
  if (metrics.expanded) {
    const extra = metrics.optimizedTokens - metrics.originalTokens;
    const pct =
      metrics.originalTokens > 0
        ? Math.round((extra / metrics.originalTokens) * 100)
        : 0;
    return (
      `Output expanded by ${extra} tokens (+${pct}%). ${detail} ` +
      `Use depth=full only when raw bytes are required.`
    );
  }
  if (metrics.savingsPercent > 0) {
    return `${metrics.savingsPercent}% token savings. ${detail}`;
  }
  return detail;
}
