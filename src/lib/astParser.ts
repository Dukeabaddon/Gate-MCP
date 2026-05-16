/**
 * AST Parser for Gate-MCP.
 *
 * Uses tree-sitter to extract structural signatures from source code.
 * Tier 1 native: JS, TS, TSX, Python, Java, C#, C++, Go, Rust, HTML, CSS, JSON.
 * Tier 2 native (optional deps, tree-sitter @0.21 peer): PHP, Ruby, Kotlin, Bash,
 *   Swift when install + compile succeed.
 * Regex fallback: SQL, Scala, Markdown; also Vue / YAML / Svelte until grammar
 *   bindings match the bundled tree-sitter ABI (see getGrammarLoader).
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
    case "php":
      // Full PHP grammar (not php_only) — includes <?php and mixed HTML.
      return () => require("tree-sitter-php").php;
    case "ruby":
      return () => require("tree-sitter-ruby");
    case "kotlin":
      return () => require("tree-sitter-kotlin");
    case "bash":
      return () => require("tree-sitter-bash");
    case "swift":
      // Pinned to 0.6.x for tree-sitter ^0.21 peer alignment. Upstream 0.7.x
      // requires ^0.22. Native install can still fail (e.g. install path with
      // spaces breaks Makefile rules that invoke tree-sitter-cli).
      return () => require("tree-sitter-swift");
    case "vue":
    case "yaml":
      // tree-sitter-vue / tree-sitter-yaml expose NAN-built Language objects that
      // tree-sitter Node ^0.21 rejects in Parser#setLanguage ("Invalid language
      // object"). Omit loaders until core tree-sitter is upgraded repo-wide.
      return null;
    case "svelte":
      // Optional package remains for future ABI alignment; current release fails
      // node-gyp on Node 22+ without C++17 NAN fixes — avoid noisy load attempts.
      return null;
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
 * Returns true when a native tree-sitter grammar successfully loaded for this
 * language (optional dependency present and Parser#setLanguage succeeded).
 */
export function hasNativeTreeSitterGrammar(language: SupportedLanguage): boolean {
  return getParser(language) !== null;
}

/**
 * Detect Facebook Flow source files via the `@flow` pragma.
 *
 * Flow shares ~95% of its syntax with TypeScript (generics, type imports,
 * type annotations, optional chains, etc.). tree-sitter-javascript chokes on
 * Flow type annotations and silently emits `ERROR` nodes that hide the entire
 * surrounding declaration from our signature collectors.
 *
 * The fix is to detect Flow's `@flow` / `@noflow` pragma in the file header
 * and route those files to tree-sitter-typescript, which parses them with a
 * negligible error count and recovers full export coverage.
 *
 * We scan the first 4 KB. Most files put the pragma in the first 1 KB, but
 * Meta's source files often have lengthy MIT/Apache license headers that
 * push the @flow pragma past line 30 (e.g. react-dom-bindings escape util).
 * 4 KB covers every observed case while staying effectively free per file.
 */
const FLOW_PRAGMA_RE = /@(?:no)?flow\b/;
export function detectFlowFile(source: string): boolean {
  return FLOW_PRAGMA_RE.test(source.slice(0, 4096));
}

/**
 * Pick the tree-sitter language to use for a file.
 *
 * Most languages map 1:1 to their grammar, but a .js file may actually be
 * Flow-typed (see detectFlowFile). For those, return `tsx` — the TypeScript
 * TSX grammar is a strict superset of plain TS that also parses JSX, which
 * Flow files frequently contain (React component files are .js + @flow + JSX).
 * The plain TypeScript grammar fails on JSX with cascading ERROR nodes.
 */
function pickGrammarLanguage(
  language: SupportedLanguage,
  source: string
): SupportedLanguage {
  if (language === "javascript" && detectFlowFile(source)) {
    return "tsx";
  }
  return language;
}

/**
 * Extract structural signatures from source code using tree-sitter AST.
 * Falls back to regex extraction when no native parser is available.
 */
export function extractSignatures(
  source: string,
  language: SupportedLanguage
): FileSignature {
  // Route Flow-typed .js files through the TypeScript grammar (see
  // pickGrammarLanguage doc-comment). JS/TS share collector logic so the
  // downstream traverseNode call still receives "javascript".
  const grammarLang = pickGrammarLanguage(language, source);
  const parser = getParser(grammarLang);

  if (!parser) {
    return extractSignaturesRegex(source, language);
  }

  try {
    // tree-sitter's Node binding has a ~32KB string buffer; large source strings
    // throw "Invalid argument". The callback variant streams chunks and works
    // for files of any size. Always use it for correctness.
    const tree = parseWithCallback(parser, source);
    const root = tree.rootNode;

    // Adversarial-review guard (FAIROS Principle 4):
    //   When the AST root itself is an ERROR node, the grammar gave up on the
    //   file. Inside an ERROR tree, error recovery can emit junk
    //   `function_declaration` nodes — e.g. `if (...)`, `then(...)`, etc. —
    //   that our extractor cannot distinguish from real declarations. The
    //   resulting compressed view is worse than the regex fallback because it
    //   loses real exports AND adds false ones. Reject the AST output here.
    if (root.type === "ERROR") {
      logger.warn(
        `AST root is ERROR for ${language} (${source.length} bytes); using regex fallback`
      );
      return extractSignaturesRegex(source, language);
    }

    const result: FileSignature = { imports: [], exports: [], functions: [], classes: [] };
    // Traverse using the collector for the SOURCE language, not the grammar
    // language — Flow files should look like "javascript" to consumers.
    traverseNode(root, language === "javascript" ? "javascript" : language, result);

    // ESM-only AST collectors miss CommonJS export forms — `module.exports.X = ...`
    // and `exports.X = ...` get parsed as assignment_expressions with no
    // semantic export status. React's npm shim files are 100% CJS. Augment.
    if (language === "javascript" || language === "typescript" || language === "tsx") {
      augmentWithCjsExports(source, result);
    }

    return result;
  } catch (err) {
    logger.warn(`AST parsing failed for ${language}, falling back to regex: ${err}`);
    return extractSignaturesRegex(source, language);
  }
}

/**
 * Supplement AST-extracted exports with CommonJS patterns.
 *
 * tree-sitter-javascript and tree-sitter-typescript do not classify
 * `exports.foo = bar` or `module.exports.foo = bar` as export nodes — they
 * are plain assignment expressions. For files that use CJS exclusively
 * (npm distribution shims, jest test helpers, transpiled output) this
 * means the AST extractor returns no exports at all.
 *
 * This pass scans the raw source for the two CJS forms and appends them
 * to result.exports. Duplicate names are harmless; the compressed view
 * just contains the symbol once or twice.
 */
const CJS_EXPORT_RE = /^[\t ]*(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/gm;
const CJS_DEFAULT_RE = /^[\t ]*module\.exports\s*=/m;

function augmentWithCjsExports(source: string, result: FileSignature): void {
  let m: RegExpExecArray | null;
  CJS_EXPORT_RE.lastIndex = 0;
  while ((m = CJS_EXPORT_RE.exec(source)) !== null) {
    result.exports.push(`exports.${m[1]} = ...`);
  }
  if (CJS_DEFAULT_RE.test(source)) {
    result.exports.push("module.exports = ...");
  }
}

/**
 * Parse a source string via tree-sitter's chunk-callback API.
 *
 * The default `parser.parse(string)` path in tree-sitter ^0.21 has an internal
 * ~32 KB string buffer and throws "Invalid argument" on larger files. The
 * callback variant streams the source in fixed-size slices and bypasses
 * that cap. Chunks must stay strictly below the buffer limit.
 *
 * Chunk size 4 KB: small enough to never trigger the limit, large enough
 * that overhead is negligible (50 callbacks for a 200 KB file).
 */
function parseWithCallback(parser: any, source: string): any {
  const CHUNK = 4096;
  const len = source.length;
  return parser.parse((index: number, _pos: any) => {
    if (index >= len) return "";
    return source.slice(index, Math.min(index + CHUNK, len));
  });
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
    case "php":
      collectPhpNode(node, type, result);
      break;
    case "ruby":
      collectRubyNode(node, type, result);
      break;
    case "kotlin":
      collectKotlinNode(node, type, result);
      break;
    case "swift":
      collectSwiftNode(node, type, result);
      break;
    case "bash":
      collectBashNode(node, type, result);
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
    // The shape of an export determines how much of it to keep.
    //
    //   export function foo() { 200 lines of body... }
    //     -> just record "export function foo(args)". The body is already
    //        captured by the function_declaration child via Functions section.
    //        Duplicating the full body in Exports adds enormous token cost.
    //
    //   export class Foo { ... }
    //   export interface Foo { ... }
    //     -> just record the class/interface header line.
    //
    //   export { A, B, C } from './x'
    //     -> keep the full block (the symbol names are the value).
    //
    //   export type X = ...
    //   export default <expression>
    //   export const X = ...
    //     -> keep full text (usually short).
    //
    // Decision: peek at the wrapped declaration's type.
    let wrapped: any = null;
    for (let i = 0; i < node.childCount; i++) {
      const c = node.child(i);
      const ct = c.type;
      if (
        ct === "function_declaration" ||
        ct === "class_declaration" ||
        ct === "interface_declaration" ||
        ct === "generator_function_declaration"
      ) {
        wrapped = c;
        break;
      }
    }

    if (wrapped) {
      // Body-wrapping declaration — record just the export-prefixed
      // signature, not the body.
      const firstLine = node.text.split("\n")[0].trim();
      result.exports.push(firstLine.slice(0, 400));
    } else {
      // Re-export block, type alias, default expression, or lexical
      // declaration — keep the full text so symbol names survive.
      const collapsed = node.text.trim().replace(/\s+/g, " ");
      result.exports.push(collapsed.slice(0, 4096));
    }
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

function collectPhpNode(node: any, type: string, result: FileSignature): void {
  if (type === "namespace_use_declaration") {
    result.imports.push(node.text.trim().split("\n")[0].slice(0, 400));
  }
  if (type === "function_definition") {
    const nameNode = node.childForFieldName("name");
    const params = node.childForFieldName("formal_parameters")?.text ?? "()";
    if (nameNode) {
      result.functions.push(`function ${nameNode.text}${params}`);
    }
  }
  if (type === "method_declaration") {
    const nameNode = node.childForFieldName("name");
    const params = node.childForFieldName("parameters")?.text ?? "()";
    if (nameNode) {
      result.functions.push(`function ${nameNode.text}${params}`);
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

function collectRubyNode(node: any, type: string, result: FileSignature): void {
  if (type === "call") {
    const method = node.childForFieldName("method");
    if (
      method?.type === "identifier" &&
      (method.text === "require" ||
        method.text === "require_relative" ||
        method.text === "load")
    ) {
      result.imports.push(node.text.trim().split("\n")[0].slice(0, 400));
    }
  }
  if (type === "module" || type === "class") {
    const constNode = node.namedChildren.find((c: any) => c.type === "constant");
    if (constNode) {
      result.classes.push(`${type} ${constNode.text}`);
    }
  }
  if (type === "method") {
    const nameNode = node.namedChildren.find((c: any) => c.type === "identifier");
    const paramsNode = node.namedChildren.find((c: any) => c.type === "method_parameters");
    if (nameNode && paramsNode) {
      result.functions.push(`def ${nameNode.text}${paramsNode.text}`);
    } else if (nameNode) {
      result.functions.push(`def ${nameNode.text}`);
    }
  }
}

function collectKotlinNode(node: any, type: string, result: FileSignature): void {
  if (type === "import_header") {
    result.imports.push(node.text.trim().split("\n")[0].slice(0, 400));
  }
  if (type === "function_declaration") {
    const params = node.childForFieldName("function_value_parameters")?.text ?? "()";
    const nameId = node.namedChildren.find((c: any) => c.type === "simple_identifier");
    if (nameId) {
      result.functions.push(`fun ${nameId.text}${params}`);
    }
  }
  if (type === "class_declaration") {
    const tid =
      node.childForFieldName("type_identifier") ??
      node.namedChildren.find((c: any) => c.type === "type_identifier");
    if (tid) result.classes.push(`class ${tid.text}`);
  }
}

function collectSwiftNode(node: any, type: string, result: FileSignature): void {
  if (type === "import_declaration") {
    const line = node.text.trim().split("\n")[0].replace(/\s+/g, " ");
    result.imports.push(line.slice(0, 400));
  }
  if (type === "function_declaration") {
    const head = node.text.split("{")[0].trim().replace(/\s+/g, " ");
    if (head.length > 0 && head.length < 400) {
      result.functions.push(head);
    }
  }
  if (type === "class_declaration" || type === "protocol_declaration") {
    const head = node.text.split("{")[0].trim().replace(/\s+/g, " ");
    if (head.length > 0 && head.length < 400) {
      result.classes.push(head);
    }
  }
}

function collectBashNode(node: any, type: string, result: FileSignature): void {
  if (type === "command") {
    const line = node.text.trim().split("\n")[0];
    if (/^(?:source|[.])\s/.test(line)) {
      result.imports.push(line.slice(0, 400));
    }
  }
  if (type === "function_definition") {
    const head = node.text.split("{")[0].trim().replace(/\s+/g, " ");
    if (head.length > 0 && head.length < 400) {
      result.functions.push(head);
    }
  }
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

    // Generic exports (ESM + CJS)
    if (/^export\s/.test(trimmed) || /^module\.exports/.test(trimmed)) {
      exports.push(trimmed.split("{")[0].trim().slice(0, 200));
    }
    // CJS named exports: `exports.foo = ...` (without preceding module.)
    const cjsMatch = trimmed.match(/^exports\.([A-Za-z_$][\w$]*)\s*=/);
    if (cjsMatch) {
      exports.push(`exports.${cjsMatch[1]} = ...`);
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
