/**
 * AST Parser for Gate-MCP.
 *
 * Uses tree-sitter to extract structural signatures from source code.
 * Supports JavaScript, TypeScript, and Python.
 * Falls back to regex-based extraction for unsupported languages.
 */

import { createRequire } from "node:module";
import path from "node:path";
import logger from "./logger.js";
import type { FileSignature, SupportedLanguage } from "../types.js";

// tree-sitter uses native modules — we need createRequire for CJS compat
const require = createRequire(import.meta.url);

let Parser: any = null;
let parserCache: Map<string, any> = new Map();

/**
 * Detect language from file extension.
 */
export function detectLanguage(filePath: string): SupportedLanguage {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".js":
    case ".jsx":
    case ".mjs":
      return "javascript";
    case ".ts":
    case ".tsx":
      return "typescript";
    case ".py":
      return "python";
    default:
      return "unknown";
  }
}

/**
 * Load tree-sitter and the appropriate language grammar.
 */
function getParser(language: SupportedLanguage): any | null {
  if (language === "unknown") return null;

  try {
    if (!Parser) {
      Parser = require("tree-sitter");
    }

    if (parserCache.has(language)) {
      return parserCache.get(language);
    }

    let grammar: any;
    switch (language) {
      case "javascript":
        grammar = require("tree-sitter-javascript");
        break;
      case "typescript":
        grammar = require("tree-sitter-typescript").typescript;
        break;
      case "python":
        grammar = require("tree-sitter-python");
        break;
      default:
        return null;
    }

    const parser = new Parser();
    parser.setLanguage(grammar);
    parserCache.set(language, parser);

    logger.debug(`tree-sitter parser loaded for ${language}`);
    return parser;
  } catch (err) {
    logger.warn(`tree-sitter failed for ${language}: ${err}`);
    return null;
  }
}

// ─── AST-based signature extraction ─────────────────────────────────────────

/**
 * Extract structural signatures from source code using tree-sitter AST.
 */
export function extractSignatures(
  source: string,
  language: SupportedLanguage
): FileSignature {
  const parser = getParser(language);

  if (!parser) {
    return extractSignaturesRegex(source, language);
  }

  try {
    const tree = parser.parse(source);
    const root = tree.rootNode;

    const imports: string[] = [];
    const exports: string[] = [];
    const functions: string[] = [];
    const classes: string[] = [];

    traverseNode(root, language, { imports, exports, functions, classes });

    return { imports, exports, functions, classes };
  } catch (err) {
    logger.warn(`AST parsing failed, falling back to regex: ${err}`);
    return extractSignaturesRegex(source, language);
  }
}

/**
 * Recursively traverse AST nodes to collect signatures.
 */
function traverseNode(
  node: any,
  language: SupportedLanguage,
  result: FileSignature
): void {
  const type = node.type;

  switch (language) {
    case "javascript":
    case "typescript":
      collectJsTsNode(node, type, result);
      break;
    case "python":
      collectPythonNode(node, type, result);
      break;
  }

  for (let i = 0; i < node.childCount; i++) {
    traverseNode(node.child(i), language, result);
  }
}

function collectJsTsNode(node: any, type: string, result: FileSignature): void {
  // Import declarations
  if (type === "import_statement" || type === "import_declaration") {
    result.imports.push(node.text.trim());
  }

  // Export declarations
  if (type === "export_statement" || type === "export_declaration") {
    const text = node.text.trim();
    // Extract the first meaningful line (avoid dumping entire exported function bodies)
    const firstLine = text.split("\n")[0];
    result.exports.push(firstLine);
  }

  // Function declarations
  if (
    type === "function_declaration" ||
    type === "method_definition" ||
    type === "arrow_function"
  ) {
    const name = extractFunctionName(node, type);
    if (name) {
      const params = extractParams(node);
      const returnType = extractReturnType(node);
      const signature = `function ${name}(${params})${returnType ? `: ${returnType}` : ""}`;
      result.functions.push(signature);
    }
  }

  // Class declarations
  if (type === "class_declaration") {
    const nameNode = node.childForFieldName("name");
    if (nameNode) {
      result.classes.push(`class ${nameNode.text}`);
    }
  }
}

function collectPythonNode(node: any, type: string, result: FileSignature): void {
  // Import statements
  if (type === "import_statement" || type === "import_from_statement") {
    result.imports.push(node.text.trim());
  }

  // Function definitions
  if (type === "function_definition") {
    const nameNode = node.childForFieldName("name");
    const paramsNode = node.childForFieldName("parameters");
    if (nameNode) {
      const params = paramsNode ? paramsNode.text : "()";
      result.functions.push(`def ${nameNode.text}${params}`);
    }
  }

  // Class definitions
  if (type === "class_definition") {
    const nameNode = node.childForFieldName("name");
    if (nameNode) {
      result.classes.push(`class ${nameNode.text}`);
    }
  }
}

function extractFunctionName(node: any, type: string): string | null {
  // Direct name field
  const nameNode = node.childForFieldName("name");
  if (nameNode) return nameNode.text;

  // Arrow functions assigned to variables
  if (type === "arrow_function") {
    const parent = node.parent;
    if (parent?.type === "variable_declarator") {
      const varName = parent.childForFieldName("name");
      return varName?.text ?? null;
    }
  }

  return null;
}

function extractParams(node: any): string {
  const paramsNode =
    node.childForFieldName("parameters") ??
    node.childForFieldName("formal_parameters");
  if (!paramsNode) return "";

  // Strip outer parens and return clean param list
  const text = paramsNode.text;
  return text.replace(/^\(/, "").replace(/\)$/, "").trim();
}

function extractReturnType(node: any): string | null {
  const returnType = node.childForFieldName("return_type");
  if (!returnType) return null;
  // Remove leading colon/space
  return returnType.text.replace(/^:\s*/, "").trim();
}

// ─── Regex fallback for unsupported languages ───────────────────────────────

function extractSignaturesRegex(
  source: string,
  _language: SupportedLanguage
): FileSignature {
  const lines = source.split("\n");
  const imports: string[] = [];
  const exports: string[] = [];
  const functions: string[] = [];
  const classes: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Imports
    if (/^import\s/.test(trimmed) || /^from\s/.test(trimmed) || /^require\(/.test(trimmed)) {
      imports.push(trimmed);
    }

    // Exports
    if (/^export\s/.test(trimmed) || /^module\.exports/.test(trimmed)) {
      exports.push(trimmed.split("\n")[0]);
    }

    // Functions
    if (/^(export\s+)?(async\s+)?function\s+\w+/.test(trimmed)) {
      functions.push(trimmed.split("{")[0].trim());
    }
    if (/^def\s+\w+/.test(trimmed)) {
      functions.push(trimmed.split(":")[0].trim());
    }

    // Classes
    if (/^(export\s+)?class\s+\w+/.test(trimmed)) {
      classes.push(trimmed.split("{")[0].split(":")[0].trim());
    }
  }

  return { imports, exports, functions, classes };
}

/**
 * Format a FileSignature into a readable string block.
 */
export function formatSignature(sig: FileSignature, language: string): string {
  const sections: string[] = [];

  sections.push(`// Language: ${language}`);
  sections.push(`// Extracted signature (gate-mcp v0.1)`);
  sections.push("");

  if (sig.imports.length > 0) {
    sections.push("// ─── Imports ───");
    sig.imports.forEach((i) => sections.push(i));
    sections.push("");
  }

  if (sig.classes.length > 0) {
    sections.push("// ─── Classes ───");
    sig.classes.forEach((c) => sections.push(c));
    sections.push("");
  }

  if (sig.functions.length > 0) {
    sections.push("// ─── Functions ───");
    sig.functions.forEach((f) => sections.push(f));
    sections.push("");
  }

  if (sig.exports.length > 0) {
    sections.push("// ─── Exports ───");
    sig.exports.forEach((e) => sections.push(e));
    sections.push("");
  }

  if (
    sig.imports.length === 0 &&
    sig.exports.length === 0 &&
    sig.functions.length === 0 &&
    sig.classes.length === 0
  ) {
    sections.push("// No structural signatures detected.");
  }

  return sections.join("\n");
}
