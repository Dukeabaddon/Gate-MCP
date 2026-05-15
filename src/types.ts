/**
 * Gate-MCP Type Definitions
 * All shared types for the context compression gateway.
 */

// ─── Image Optimization Types ───────────────────────────────────────────────

export type ImageIntent = "text" | "visual" | "auto";

export interface ImageOptimizeInput {
  imagePath: string;
  intent?: ImageIntent;
}

export interface ImageMetadata {
  width: number;
  height: number;
  format: string;
  size: number;
}

export interface OcrResult {
  text: string;
  confidence: number;
}

export interface TextExtractedResult {
  type: "text_extracted";
  text: string;
  originalTokens: number;
  optimizedTokens: number;
  savingsPercent: number;
  note: string;
}

export interface VisualOptimizedResult {
  type: "visual_optimized";
  imagePath: string;
  extractedText: string;
  originalTokens: number;
  optimizedTokens: number;
  savingsPercent: number;
  note: string;
}

export type ImageOptimizeResult = TextExtractedResult | VisualOptimizedResult;

// ─── File Compression Types ─────────────────────────────────────────────────

export type CompressionDepth = "signature" | "summary" | "full";

export interface CompressFileInput {
  filePath: string;
  depth?: CompressionDepth;
}

export type SupportedLanguage =
  | "javascript"
  | "typescript"
  | "tsx"
  | "python"
  | "java"
  | "csharp"
  | "cpp"
  | "c"
  | "go"
  | "rust"
  | "ruby"
  | "php"
  | "kotlin"
  | "swift"
  | "scala"
  | "html"
  | "css"
  | "json"
  | "yaml"
  | "sql"
  | "bash"
  | "vue"
  | "svelte"
  | "markdown"
  | "unknown";

export interface FileSignature {
  imports: string[];
  exports: string[];
  functions: string[];
  classes: string[];
}

export interface CompressFileResult {
  type: "signature" | "summary" | "full";
  content: string;
  language: string;
  originalTokens: number;
  optimizedTokens: number;
  savingsPercent: number;
  note: string;
}

// ─── Graph Query Types ──────────────────────────────────────────────────────

export type GraphQueryType =
  | "depends_on"
  | "dependents"
  | "file_symbols"
  | "search"
  | "stats";

export interface GraphQueryInput {
  query: string;
  projectRoot?: string;
  queryType?: GraphQueryType;
  rebuild?: boolean;
}

export interface GraphQueryResult {
  query: string;
  queryType: string;
  result: string;
  nodesTraversed: number;
  originalTokens: number;
  optimizedTokens: number;
  savingsPercent: number;
  note: string;
}

// ─── Memory Types ───────────────────────────────────────────────────────────

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

// ─── Clean Response Types ───────────────────────────────────────────────────

export type CleanResponseFormat = "toon" | "compact" | "whitelist";

export interface CleanResponseInput {
  data: string;
  format?: CleanResponseFormat;
  whitelist?: string[];
  maxArrayItems?: number;
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

// ─── Token Metrics ──────────────────────────────────────────────────────────

export interface TokenMetrics {
  originalTokens: number;
  optimizedTokens: number;
  savingsPercent: number;
}

// ─── Image Processor Interface ──────────────────────────────────────────────

export interface ImageProcessor {
  getMetadata(imagePath: string): Promise<ImageMetadata>;
  resize(
    imagePath: string,
    maxWidth: number,
    quality: number,
    outputPath: string
  ): Promise<{ width: number; height: number }>;
}
