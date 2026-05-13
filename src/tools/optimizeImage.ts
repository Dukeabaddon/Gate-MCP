/**
 * gate_optimize_image tool implementation.
 *
 * Compresses image inputs by extracting text (OCR) or downscaling,
 * providing token savings metrics in every response.
 */

import fs from "node:fs";
import path from "node:path";
import {
  getImageMetadata,
  resizeImage,
  runOcr,
} from "../lib/imageProcessor.js";
import {
  estimateImageTokens,
  countTextTokens,
  calculateSavings,
} from "../lib/tokenCounter.js";
import logger from "../lib/logger.js";
import type { ImageIntent, ImageOptimizeResult } from "../types.js";

/**
 * Main handler for gate_optimize_image.
 */
export async function handleOptimizeImage(args: {
  imagePath: string;
  intent?: ImageIntent;
}): Promise<ImageOptimizeResult> {
  const { intent = "auto" } = args;

  // 1. Resolve and validate path
  const imagePath = path.isAbsolute(args.imagePath)
    ? args.imagePath
    : path.resolve(process.cwd(), args.imagePath);

  if (!fs.existsSync(imagePath)) {
    throw new Error(`Image file not found: ${imagePath}`);
  }

  logger.info(`Processing image: ${imagePath} (intent=${intent})`);

  // 2. Get image metadata
  const metadata = await getImageMetadata(imagePath);
  logger.debug(
    `Metadata: ${metadata.width}x${metadata.height} ${metadata.format}`
  );

  // 3. Estimate original token cost (high-detail)
  const originalTokens = estimateImageTokens(
    metadata.width,
    metadata.height,
    "high"
  );

  // 4. Determine processing mode
  let effectiveIntent: "text" | "visual" = intent === "auto" ? "visual" : intent;
  let autoNote = "";

  if (intent === "auto") {
    logger.info("Auto-detecting intent via OCR confidence check...");
    const quickOcr = await runOcr(imagePath, 512);

    if (quickOcr.confidence > 70) {
      effectiveIntent = "text";
      autoNote = `Auto-detected as text-heavy (OCR confidence: ${Math.round(quickOcr.confidence)}%).`;
    } else if (quickOcr.confidence < 30) {
      effectiveIntent = "visual";
      autoNote = `Auto-detected as visual (OCR confidence: ${Math.round(quickOcr.confidence)}% — very low).`;
    } else {
      effectiveIntent = "visual";
      autoNote = `Auto-detected as visual (OCR confidence: ${Math.round(quickOcr.confidence)}%).`;
    }

    logger.info(autoNote);
  }

  // 5. Process based on intent
  if (effectiveIntent === "text") {
    return processTextHeavy(imagePath, originalTokens, autoNote);
  } else {
    return processVisual(imagePath, originalTokens, autoNote);
  }
}

async function processTextHeavy(
  imagePath: string,
  originalTokens: number,
  autoNote: string
): Promise<ImageOptimizeResult> {
  const ocrResult = await runOcr(imagePath, 768);
  const textTokens = countTextTokens(ocrResult.text);
  const savings = calculateSavings(originalTokens, textTokens);

  return {
    type: "text_extracted",
    text: ocrResult.text || "(No text could be extracted.)",
    originalTokens: savings.originalTokens,
    optimizedTokens: savings.optimizedTokens,
    savingsPercent: savings.savingsPercent,
    note: [
      autoNote,
      "Image text extracted to save tokens.",
      `OCR confidence: ${Math.round(ocrResult.confidence)}%.`,
    ]
      .filter(Boolean)
      .join(" "),
  };
}

async function processVisual(
  imagePath: string,
  originalTokens: number,
  autoNote: string
): Promise<ImageOptimizeResult> {
  const { outputPath, width, height } = await resizeImage(imagePath, 512, 80);

  let extractedText = "";
  try {
    const ocrResult = await runOcr(outputPath);
    extractedText = ocrResult.text;
  } catch (err) {
    logger.warn(`Supplementary OCR failed: ${err}`);
  }

  const imageTokens = estimateImageTokens(width, height, "low");
  const textTokens = countTextTokens(extractedText);
  const optimizedTokens = imageTokens + textTokens;
  const savings = calculateSavings(originalTokens, optimizedTokens);

  return {
    type: "visual_optimized",
    imagePath: outputPath,
    extractedText: extractedText || "(No supplementary text detected.)",
    originalTokens: savings.originalTokens,
    optimizedTokens: savings.optimizedTokens,
    savingsPercent: savings.savingsPercent,
    note: [
      autoNote,
      `Image downscaled to ${width}x${height} (80% JPEG).`,
      extractedText ? "Supplementary OCR text extracted." : "",
    ]
      .filter(Boolean)
      .join(" "),
  };
}
