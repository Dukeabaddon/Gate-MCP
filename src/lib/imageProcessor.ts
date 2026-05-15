/**
 * Image processing module for Gate-MCP.
 *
 * Primary: sharp (fast native bindings)
 * Fallback: jimp (pure JS, works everywhere)
 *
 * Also wraps tesseract.js for local OCR.
 */

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import logger from "./logger.js";
import type { ImageMetadata, ImageProcessor, OcrResult } from "../types.js";

// ─── Sharp / Jimp dynamic loader ────────────────────────────────────────────

let sharpAvailable = false;
let sharpModule: any = null;

async function loadSharp(): Promise<boolean> {
  if (sharpModule) return true;
  try {
    const mod = await import("sharp");
    sharpModule = mod.default ?? mod;
    sharpAvailable = true;
    logger.info("sharp loaded successfully (native image processing)");
    return true;
  } catch {
    logger.warn("sharp not available — falling back to jimp");
    sharpAvailable = false;
    return false;
  }
}

// ─── Sharp-based processor ──────────────────────────────────────────────────

const sharpProcessor: ImageProcessor = {
  async getMetadata(imagePath: string): Promise<ImageMetadata> {
    await loadSharp();
    if (!sharpModule) throw new Error("sharp is not available");

    const meta = await sharpModule(imagePath).metadata();

    return {
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      format: meta.format ?? "unknown",
      size: meta.size ?? fs.statSync(imagePath).size,
    };
  },

  async resize(
    imagePath: string,
    maxWidth: number,
    quality: number,
    outputPath: string
  ): Promise<{ width: number; height: number }> {
    await loadSharp();
    if (!sharpModule) throw new Error("sharp is not available");

    const result = await sharpModule(imagePath)
      .resize({ width: maxWidth, withoutEnlargement: true })
      .jpeg({ quality: Math.round(quality) })
      .toFile(outputPath);

    return { width: result.width, height: result.height };
  },
};

// ─── Jimp-based fallback processor ──────────────────────────────────────────

const jimpProcessor: ImageProcessor = {
  async getMetadata(imagePath: string): Promise<ImageMetadata> {
    const { Jimp } = await import("jimp");
    const image = await Jimp.read(imagePath);
    const stat = fs.statSync(imagePath);
    const ext = path.extname(imagePath).toLowerCase().replace(".", "");

    return {
      width: image.width,
      height: image.height,
      format: ext || "unknown",
      size: stat.size,
    };
  },

  async resize(
    imagePath: string,
    maxWidth: number,
    _quality: number,
    outputPath: string
  ): Promise<{ width: number; height: number }> {
    const { Jimp } = await import("jimp");
    const image = await Jimp.read(imagePath);

    if (image.width > maxWidth) {
      const aspectRatio = image.height / image.width;
      const newHeight = Math.round(maxWidth * aspectRatio);
      image.resize({ w: maxWidth, h: newHeight });
    }

    await image.write(outputPath as `${string}.${string}`);
    return { width: image.width, height: image.height };
  },
};

// ─── Processor selector ─────────────────────────────────────────────────────

async function getProcessor(): Promise<ImageProcessor> {
  const hasSharp = await loadSharp();
  return hasSharp ? sharpProcessor : jimpProcessor;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Get image metadata (width, height, format, file size).
 */
export async function getImageMetadata(imagePath: string): Promise<ImageMetadata> {
  const processor = await getProcessor();
  return processor.getMetadata(imagePath);
}

/**
 * Resize an image to a maximum width, maintaining aspect ratio.
 * Returns the output path and new dimensions.
 */
export async function resizeImage(
  imagePath: string,
  maxWidth: number,
  quality: number = 80
): Promise<{ outputPath: string; width: number; height: number }> {
  const ext = path.extname(imagePath);
  const basename = path.basename(imagePath, ext);
  const outputDir = path.join(os.tmpdir(), "gate-mcp");

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, `${basename}_optimized.jpg`);
  const processor = await getProcessor();
  const dims = await processor.resize(imagePath, maxWidth, quality, outputPath);

  logger.debug(`Resized image: ${dims.width}x${dims.height} → ${outputPath}`);
  return { outputPath, ...dims };
}

// ─── OCR via tesseract.js ───────────────────────────────────────────────────

let tesseractWorker: any = null;

async function getOcrWorker(): Promise<any> {
  if (tesseractWorker) return tesseractWorker;

  const Tesseract = await import("tesseract.js");
  tesseractWorker = await Tesseract.createWorker("eng", undefined, {
    logger: () => {},  // Suppress tesseract progress logs
  });

  logger.info("Tesseract OCR worker initialized");
  return tesseractWorker;
}

/**
 * Run OCR on an image. Optionally pre-resize to a smaller width for speed.
 */
export async function runOcr(
  imagePath: string,
  preResizeWidth?: number
): Promise<OcrResult> {
  let targetPath = imagePath;

  // Optionally downscale first for speed (used in auto-detect confidence check)
  if (preResizeWidth) {
    try {
      const { outputPath } = await resizeImage(imagePath, preResizeWidth, 85);
      targetPath = outputPath;
    } catch (err) {
      logger.warn(`Pre-resize for OCR failed, using original: ${err}`);
    }
  }

  const worker = await getOcrWorker();
  const result = await worker.recognize(targetPath);

  const text = result.data.text?.trim() ?? "";
  const confidence = result.data.confidence ?? 0;

  logger.debug(`OCR result: ${text.length} chars, confidence=${confidence}%`);

  return { text, confidence };
}

/**
 * Terminate the OCR worker to free resources.
 */
export async function terminateOcr(): Promise<void> {
  if (tesseractWorker) {
    await tesseractWorker.terminate();
    tesseractWorker = null;
  }
}
// Last reviewed: 2026-05-15 — verified against v0.3.2 fidelity test suite.
