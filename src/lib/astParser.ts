/**
 * AST Parser for Gate-MCP.
 *
 * Uses tree-sitter to extract structural signatures from source code.
 * Native parsers: JS, TS, TSX, Python, Java, C#, C++, Go, Rust, HTML, CSS, JSON.
 * Regex fallback: SQL, PHP, Ruby, Kotlin, Swift, Scala, Vue, Svelte, YAML, Bash, Markdown.
 *
 * All native parsers are optional dependencies — loading failures degrade
 * gracefully to regex extraction without crashing the server.
 */

import { createRequire } from "node:module";
import path from "node:path";
import logger from "./logger.js";
import type { FileSignature, SupportedLanguage } from "../types.js";

const require = createRequire(import.meta.url);

let Parser: any = null;
const parserCache: Map<string, any> = new Map();
const parserLoadFailures: Set<string> = new Set();

/**
 * Detect language from file extension.
 */
export function detectLanguage(filePath: string): SupportedLanguage {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".ts":
    case ".mts":
    case ".cts":
      return "typescript";
    case ".tsx":
      return "tsx";
    case ".py":
    case ".pyi":
      return "python";
    case ".java":
      return "java";
    case ".cs":
      return "csharp";
    case ".cpp":
    case ".cc":
    case ".cxx":
    case ".hpp":
    case ".hxx":
    case ".h":
      return "cpp";
    case ".c":
      return "c";
    case ".go":
      return "go";
    case ".rs":
      return "rust";
    case ".rb":
      return "ruby";
    case ".php":
      return "php";
    case ".kt":
    case ".kts":
      return "kotlin";
    case ".swift":
      return "swift";
    case ".scala":
    case ".sc":
      return "scala";
    case ".html":
    case ".htm":
      return "html";
    case ".css":
    case ".scss":
    case ".sass":
    case ".less":
      return "css";
    case ".json":
    case ".jsonc":
      return "json";
    case ".yaml":
    case ".yml":
      return "yaml";
    case ".sql":
      return "sql";
    case ".sh":
    case ".bash":
    case ".zsh":
      return "bash";
    case ".vue":
      return "vue";
    case ".svelte":
      return "svelte";
    case ".md":
    case ".markdown":
    case ".mdx":
      return "markdown";
    default:
      return "unknown";
  }
}

/**
 * Map a language to its tree-sitter npm package + grammar export.
 * Returns null if no native parser exists for this language.
 */
function getGrammarLoader(language: SupportedLanguage): (() => any) | null {
  switch (language) {
    case "javascript":
      return () => require("tree-sitter-javascript");
    case "typescript":
      return () => require("tree-sitter-typescript").typescript;
    case "tsx":
      return () => require("tree-sitter-typescript").tsx;
    case "python":
      return () => require("tree-sitter-python");
    case "java":
      return () => require("tree-sitter-java");
    case "csharp":
      return () => require("tree-sitter-c-sharp");
    case "cpp":
    case "c":
      return () => require("tree-sitter-cpp");
    case "go":
      return () => require("tree-sitter-go");
    case "rust":
      return () => require("tree-sitter-rust");
    case "html":
      return () => require("tree-sitter-html");
    case "css":
      return () => require("tree-sitter-css");
    case "json":
      return () => require("tree-sitter-json");
    default:
      return null;
  }
}

/**
 * Load tree-sitter and the appropriate language grammar.
 * Returns null on any failure (parser missing, native compile failed, etc).
 */
function getParser(language: SupportedLanguage): any | null {
  if (language === "unknown") return null;
  if (parserLoadFailures.has(language)) return null;
  if (parserCache.has(language)) return parserCache.get(language);

  const loader = getGrammarLoader(language);
  if (!loader) return null;

  try {
    if (!Parser) Parser = require("tree-sitter");
    const grammar = loader();
    const parser = new Parser();
    parser.setLanguage(grammar);
    parserCache.set(language, parser);
    logger.debug(`tree-sitter parser loaded for ${language}`);
    return parser;
  } catch (err) {
    parserLoadFailures.add(language);
    logger.warn(`tree-sitter parser unavailable for ${language} (regex fallback will be used): ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/**
 * Extract structural signatures from source code using tree-sitter AST.
 * Falls back to regex extraction when no native parser is available.
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
    const result: FileSignature = { imports: [], exports: [], functions: [], classes: [] };
    traverseNode(root, language, result);
    return result;
  } catch (err) {
    logger.warn(`AST parsing failed for ${language}, falling back to regex: ${err}`);
    return extractSignaturesRegex(source, language);
  }
}

function traverseNode(
  node: any,
  language: SupportedLanguage,
  result: FileSignature
): void {
  const type = node.type;

  switch (language) {
    case "javascript":
    case "typescript":
    case "tsx":
      collectJsTsNode(node, type, result);
      break;
    case "python":
      collectPythonNode(node, type, result);
      break;
    case "java":
      collectJavaNode(node, type, result);
      break;
    case "csharp":
      collectCsharpNode(node, type, result);
      break;
    case "cpp":
    case "c":
      collectCppNode(node, type, result);
      break;
    case "go":
      collectGoNode(node, type, result);
      break;
    case "rust":
      collectRustNode(node, type, result);
      break;
    case "html":
      collectHtmlNode(node, type, result);
      break;
    case "css":
      collectCssNode(node, type, result);
      break;
    case "json":
      collectJsonNode(node, type, result);
      break;
  }

  for (let i = 0; i < node.childCount; i++) {
    traverseNode(node.child(i), language, result);
  }
}

// ─── Language-specific AST collectors ───────────────────────────────────────

function collectJsTsNode(node: any, type: string, result: FileSignature): void {
  if (type === "import_statement" || type === "import_declaration") {
    result.imports.push(node.text.trim());
  }
  if (type === "export_statement" || type === "export_declaration") {
    result.exports.push(node.text.trim().split("\n")[0]);
  }
  if (
    type === "function_declaration" ||
    type === "method_definition" ||
    type === "arrow_function"
  ) {
    const name = extractFunctionName(node, type);
    if (name) {
      const params = extractParams(node);
      const returnType = extractReturnType(node);
      result.functions.push(
        `function ${name}(${params})${returnType ? `: ${returnType}` : ""}`
      );
    }
  }
  if (type === "class_declaration") {
    const nameNode = node.childForFieldName("name");
    if (nameNode) result.classes.push(`class ${nameNode.text}`);
  }
  if (type === "interface_declaration") {
    const nameNode = node.childForFieldName("name");
    if (nameNode) result.classes.push(`interface ${nameNode.text}`);
  }
}

function collectPythonNode(node: any, type: string, result: FileSignature): void {
  if (type === "import_statement" || type === "import_from_statement") {
    result.imports.push(node.text.trim());
  }
  if (type === "function_definition") {
    const nameNode = node.childForFieldName("name");
    const paramsNode = node.childForFieldName("parameters");
    if (nameNode) {
      const params = paramsNode ? paramsNode.text : "()";
      result.functions.push(`def ${nameNode.text}${params}`);
    }
  }
  if (type === "class_definition") {
    const nameNode = node.childForFieldName("name");
    if (nameNode) result.classes.push(`class ${nameNode.text}`);
  }
}

function collectJavaNode(node: any, type: string, result: FileSignature): void {
  if (type === "import_declaration") {
    result.imports.push(node.text.trim());
  }
  if (type === "method_declaration" || type === "constructor_declaration") {
    const nameNode = node.childForFieldName("name");
    if (nameNode) {
      const params = node.childForFieldName("parameters")?.text ?? "()";
      result.functions.push(`${nameNode.text}${params}`);
    }
  }
  if (type === "class_declaration" || type === "interface_declaration" || type === "enum_declaration") {
    const nameNode = node.childForFieldName("name");
    if (nameNode) {
      const kw = type === "interface_declaration" ? "interface" : type === "enum_declaration" ? "enum" : "class";
      result.classes.push(`${kw} ${nameNode.text}`);
    }
  }
}

function collectCsharpNode(node: any, type: string, result: FileSignature): void {
  if (type === "using_directive") {
    result.imports.push(node.text.trim());
  }
  if (type === "method_declaration" || type === "constructor_declaration") {
    const nameNode = node.childForFieldName("name");
    if (nameNode) {
      const params = node.childForFieldName("parameters")?.text ?? "()";
      result.functions.push(`${nameNode.text}${params}`);
    }
  }
  if (
    type === "class_declaration" ||
    type === "interface_declaration" ||
    type === "struct_declaration" ||
    type === "enum_declaration" ||
    type === "record_declaration"
  ) {
    const nameNode = node.childForFieldName("name");
    if (nameNode) {
      const kw = type.replace("_declaration", "");
      result.classes.push(`${kw} ${nameNode.text}`);
    }
  }
}

function collectCppNode(node: any, type: string, result: FileSignature): void {
  if (type === "preproc_include") {
    result.imports.push(node.text.trim().split("\n")[0]);
  }
  if (type === "function_definition" || type === "function_declarator") {
    const declarator = node.childForFieldName("declarator") ?? node;
    const text = declarator.text?.split("{")[0]?.trim();
    if (text && text.length < 200) result.functions.push(text);
  }
  if (type === "class_specifier" || type === "struct_specifier") {
    const nameNode = node.childForFieldName("name");
    if (nameNode) {
      const kw = type === "struct_specifier" ? "struct" : "class";
      result.classes.push(`${kw} ${nameNode.text}`);
    }
  }
}

function collectGoNode(node: any, type: string, result: FileSignature): void {
  if (type === "import_spec" || type === "import_declaration") {
    result.imports.push(node.text.trim().split("\n")[0]);
  }
  if (type === "function_declaration" || type === "method_declaration") {
    const nameNode = node.childForFieldName("name");
    if (nameNode) {
      const params = node.childForFieldName("parameters")?.text ?? "()";
      const result_type = node.childForFieldName("result")?.text ?? "";
      result.functions.push(`func ${nameNode.text}${params}${result_type ? ` ${result_type}` : ""}`);
    }
  }
  if (type === "type_declaration") {
    const text = node.text.trim().split("\n")[0];
    if (text.includes("struct") || text.includes("interface")) {
      result.classes.push(text);
    }
  }
}

function collectRustNode(node: any, type: string, result: FileSignature): void {
  if (type === "use_declaration") {
    result.imports.push(node.text.trim());
  }
  if (type === "function_item") {
    const nameNode = node.childForFieldName("name");
    if (nameNode) {
      const params = node.childForFieldName("parameters")?.text ?? "()";
      const returnType = node.childForFieldName("return_type")?.text ?? "";
      result.functions.push(`fn ${nameNode.text}${params}${returnType ? ` ${returnType}` : ""}`);
    }
  }
  if (type === "struct_item" || type === "enum_item" || type === "trait_item" || type === "impl_item") {
    const nameNode = node.childForFieldName("name") ?? node.childForFieldName("type");
    if (nameNode) {
      const kw = type.replace("_item", "");
      result.classes.push(`${kw} ${nameNode.text}`);
    }
  }
}

function collectHtmlNode(node: any, type: string, result: FileSignature): void {
  // For HTML: treat top-level elements as "classes", scripts/links as "imports"
  if (type === "script_element" || type === "style_element") {
    const text = node.text.split("\n")[0].slice(0, 120);
    result.imports.push(text);
  }
  if (type === "element") {
    const startTag = node.child(0);
    if (startTag?.type === "start_tag") {
      const tagName = startTag.childForFieldName("name")?.text;
      const idMatch = startTag.text.match(/id=["']([^"']+)["']/);
      if (tagName && idMatch) {
        result.classes.push(`<${tagName} id="${idMatch[1]}">`);
      }
    }
  }
}

function collectCssNode(node: any, type: string, result: FileSignature): void {
  // For CSS: import statements + each rule's selector
  if (type === "import_statement") {
    result.imports.push(node.text.trim());
  }
  if (type === "rule_set") {
    const selectors = node.childForFieldName("selectors")?.text ?? node.child(0)?.text;
    if (selectors) result.functions.push(selectors.trim().slice(0, 200));
  }
}

function collectJsonNode(_node: any, _type: string, _result: FileSignature): void {
  // JSON has no functions/classes/imports — leave empty. Just having the AST
  // proves the file parsed cleanly. Top-level keys could be listed if needed.
}

// ─── Shared AST helpers ─────────────────────────────────────────────────────

function extractFunctionName(node: any, type: string): string | null {
  const nameNode = node.childForFieldName("name");
  if (nameNode) return nameNode.text;
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
  return paramsNode.text.replace(/^\(/, "").replace(/\)$/, "").trim();
}

function extractReturnType(node: any): string | null {
  const returnType = node.childForFieldName("return_type");
  if (!returnType) return null;
  return returnType.text.replace(/^:\s*/, "").trim();
}

// ─── Regex fallback for unsupported languages ───────────────────────────────

function extractSignaturesRegex(
  source: string,
  language: SupportedLanguage
): FileSignature {
  const lines = source.split("\n");
  const imports: string[] = [];
  const exports: string[] = [];
  const functions: string[] = [];
  const classes: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Generic imports across many languages
    if (
      /^import\s/.test(trimmed) ||
      /^from\s.+\simport\s/.test(trimmed) ||
      /^require\s*\(/.test(trimmed) ||
      /^use\s+/.test(trimmed) ||
      /^using\s+/.test(trimmed) ||
      /^#include\s/.test(trimmed) ||
      /^@import\s/.test(trimmed)
    ) {
      imports.push(trimmed.slice(0, 200));
    }

    // Generic exports
    if (/^export\s/.test(trimmed) || /^module\.exports/.test(trimmed)) {
      exports.push(trimmed.split("{")[0].trim().slice(0, 200));
    }

    // Functions across languages
    if (
      /^(export\s+)?(async\s+)?function\s+\w+/.test(trimmed) || // JS/TS
      /^def\s+\w+/.test(trimmed) || // Python
      /^func\s+\w+/.test(trimmed) || // Go/Swift
      /^fn\s+\w+/.test(trimmed) || // Rust
      /^sub\s+\w+/.test(trimmed) || // Perl/VB
      /^(public|private|protected|internal|static)\s+(static\s+)?[\w<>\[\]]+\s+\w+\s*\(/.test(trimmed) // Java/C#
    ) {
      functions.push(trimmed.split("{")[0].split(":=")[0].trim().slice(0, 200));
    }

    // Classes / structs / interfaces / traits
    if (
      /^(export\s+)?(public\s+)?(abstract\s+)?class\s+\w+/.test(trimmed) ||
      /^(public\s+)?(abstract\s+)?interface\s+\w+/.test(trimmed) ||
      /^(public\s+)?(abstract\s+)?struct\s+\w+/.test(trimmed) ||
      /^(pub\s+)?trait\s+\w+/.test(trimmed) ||
      /^(pub\s+)?enum\s+\w+/.test(trimmed) ||
      /^type\s+\w+\s+(struct|interface)/.test(trimmed) // Go
    ) {
      classes.push(trimmed.split("{")[0].split("(")[0].trim().slice(0, 200));
    }

    // SQL: detect CREATE / SELECT / etc as "functions"
    if (language === "sql") {
      if (/^(create|drop|alter)\s+(table|view|index|procedure|function)\s+\w+/i.test(trimmed)) {
        functions.push(trimmed.split("(")[0].trim().slice(0, 200));
      }
    }

    // YAML: top-level keys as classes
    if (language === "yaml" && /^\w[\w-]*:/.test(trimmed)) {
      classes.push(trimmed.slice(0, 200));
    }

    // Bash: function declarations
    if (language === "bash") {
      if (/^(function\s+)?\w+\s*\(\s*\)/.test(trimmed)) {
        functions.push(trimmed.split("{")[0].trim());
      }
    }

    // Markdown: headings as "classes" (table of contents)
    if (language === "markdown" && /^#{1,3}\s+\S/.test(trimmed)) {
      classes.push(trimmed.slice(0, 200));
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
  sections.push(`// Extracted signature (gatemcp v0.3)`);
  sections.push("");

  if (sig.imports.length > 0) {
    sections.push("// ─── Imports ───");
    sig.imports.forEach((i) => sections.push(i));
    sections.push("");
  }
  if (sig.classes.length > 0) {
    sections.push("// ─── Classes / Types ───");
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
