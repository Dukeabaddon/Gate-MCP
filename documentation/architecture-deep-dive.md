# Gate-MCP: Architecture Deep Dive
## Technical Reference for Contributors

---

## 1. Data Flow

```
User Request → MCP Client (Cursor/Claude/etc)
                    ↓
            ┌─ ListTools ──→ gate_help (L0: terse schemas, full docs on demand)
            │
            ├─ graph_query ──→ symbolGraph.ts (L1: BFS/DFS adjacency list)
            │                     ↓ buildGraph()
            │                 astParser.ts → tree-sitter WASM
            │                     ↓ parseFile()
            │                 In-memory Map<string, SymbolNode>
            │
            ├─ compress_file ──→ compressFile.ts (L2: AST signature extraction)
            │                      ↓
            │                  astParser.ts → tree-sitter
            │                      ↓
            │                  dedupContext.ts (SHA-256 cache check)
            │
            ├─ clean_response ──→ cleanResponse.ts (L3: TOON notation)
            │                       ↓
            │                   JSON → pipe-delimited table
            │
            ├─ optimize_image ──→ optimizeImage.ts (L2: OCR/downscale)
            │                       ↓
            │                   sharp (resize) + tesseract.js (OCR)
            │
            └─ memory ──→ memory.ts (persistence layer)
                            ↓
                        .gate-mcp/memory.json (fs read/write)
```

---

## 2. Symbol Graph Engine (symbolGraph.ts)

### Data Structure
```typescript
// In-memory adjacency list
Map<string, {
  id: string;
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'import';
  file: string;
  line: number;
  dependencies: Set<string>;  // outgoing edges
  dependents: Set<string>;    // incoming edges
}>
```

### Build Process
1. Walk project directory, collect `.ts`, `.js`, `.py` files
2. For each file: parse with tree-sitter → extract symbols + imports
3. Resolve import paths (`.js` → `.ts` mapping for ESM)
4. Build adjacency list with bidirectional edges
5. Cache graph keyed by `projectRoot`

### Query Types
- `stats`: Node/edge count, build time
- `search`: Fuzzy name matching across all symbols
- `depends_on`: BFS forward traversal from a symbol/file
- `dependents`: BFS reverse traversal (who depends on this?)
- `file_symbols`: List all symbols in a specific file

### Performance Characteristics
- Build: O(n × m) where n=files, m=avg symbols per file
- Search: O(n) linear scan (could be optimized with trie)
- BFS: O(V + E) standard BFS complexity
- Memory: ~2 bytes per node (Map entry overhead)

---

## 3. AST Parser (astParser.ts)

### tree-sitter Integration
```
File → readFileSync() → tree-sitter.parse() → walk AST
  → Extract: function_declaration, class_declaration,
             interface_declaration, type_alias_declaration,
             import_declaration
  → Output: { imports[], functions[], classes[], interfaces[], types[] }
```

### Fallback Strategy
If tree-sitter throws `Invalid argument` (happens on some large/unusual TS files):
1. Catch the error
2. Fall back to regex-based extraction
3. Log warning but continue processing

### Supported Languages (v0.3.0)

**Tier 1 — Native tree-sitter AST extraction**

| Language | Parser | Status |
|---|---|---|
| TypeScript | `tree-sitter-typescript` (.typescript grammar) | ✅ Full support |
| TSX | `tree-sitter-typescript` (.tsx grammar) | ✅ Full support — fixed v0.3.0 |
| JavaScript | `tree-sitter-javascript` | ✅ Full support |
| Python | `tree-sitter-python` | ✅ Full support |
| Java | `tree-sitter-java` | ✅ Full support |
| C# | `tree-sitter-c-sharp` | ✅ Full support |
| C/C++ | `tree-sitter-cpp` | ✅ Full support |
| Go | `tree-sitter-go` | ✅ Full support |
| Rust | `tree-sitter-rust` | ✅ Full support |
| HTML | `tree-sitter-html` | ✅ Elements + scripts + styles |
| CSS / SCSS / LESS | `tree-sitter-css` | ✅ Selectors + imports |
| JSON | `tree-sitter-json` | ✅ Parse-validation only |

All Tier 1 parsers are `optionalDependencies` — compile failures degrade to regex extraction without blocking startup.

**Tier 2 — Regex fallback** (functional, less accurate)

PHP, Ruby, Kotlin, Swift, Scala, Vue, Svelte, YAML, SQL, Bash, Markdown.

**Not supported:** VB.NET, Dart — no maintained tree-sitter grammar.

---

## 4. TOON Notation (cleanResponse.ts)

### Format Specification
```
# JSON Input:
[{"id":1,"name":"Alice","role":"admin"},{"id":2,"name":"Bob","role":"user"}]

# TOON Output:
id|name|role
1|Alice|admin
2|Bob|user
```

### Rules
1. Arrays of uniform objects → pipe-delimited table
2. Nested objects → `[section]` headers + key-value pairs
3. Non-uniform data → minified JSON fallback
4. Pipe characters in values → `¦` (U+00A6 BROKEN BAR)
5. Null/undefined → empty string between pipes
6. Arrays with >50 items → truncated with `... +N more`

### Modes
| Mode | Input | Output | Savings |
|---|---|---|---|
| `toon` | Any JSON | Pipe-delimited tables | 37% avg |
| `compact` | Any JSON | Minified JSON (no whitespace) | 10-20% |
| `whitelist` | JSON + field list | Only specified fields → TOON | 60-81% |

---

## 5. Dedup Cache (dedupContext.ts)

### Mechanism
```
File path → readFileSync() → SHA-256 hash
  → Cache lookup (Map<hash, {content, tokens, timestamp}>)
    → HIT: Return cached content (~15 tokens response)
    → MISS: Process file, store in cache
```

### Integration
- `gate_compress_file` auto-calls dedup on every read
- Dedup is session-scoped (cleared on server restart)
- Use `action='stats'` to see hit rates

---

## 6. Token Counting (tokenCounter.ts)

### Method
```typescript
import { encode } from "gpt-tokenizer";

function countTextTokens(text: string): number {
  return encode(text).length;
}
```

### Rationale
- Uses `gpt-tokenizer` for real BPE counts (cl100k_base by default)
- More accurate than char/3.5 estimate (older versions of this doc claimed char/3.5 — that was inaccurate)
- Adds ~3MB to install footprint, ~1ms per call
- Image tokens still estimated via OpenAI tile model: `(w * h) / 750` for high-detail, `/1500` for low-detail

---

## 7. Persistence (memory.ts)

### Storage
```
.gate-mcp/
  └── memory.json    # { "key": "value", ... }
```

### Operations
| Action | Behavior |
|---|---|
| `write` | Set key-value, create dir if needed, write to disk |
| `read` | Get value by key, return null if missing |
| `delete` | Remove key, write to disk |
| `list` | Return all keys with value previews |
| `clear` | Empty the store, write `{}` to disk |

### Limitations
- No file locking (race condition with concurrent sessions)
- No encryption (values stored in plaintext)
- No TTL/expiry (values persist forever until deleted)
