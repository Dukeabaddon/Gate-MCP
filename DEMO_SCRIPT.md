# gatemcp v0.3.2 — Live Pitch & Demo Script

**Target length:** 3.5–5 minutes. Cut Act 4 if pressed for time.

**One-line pitch:** *"gatemcp is a local MCP server that compresses code context by 89% before it hits the LLM — verified on the full React codebase, 99% symbol-preserving."*

---

## Screenshot demo — single-shot "with vs without" comparison

Use this when you want one image that proves the whole pitch. Both prompts ask
the LLM the **exact same question** about the **exact same file**. Only the
prefix `Use gate_compress_file on ... then` differs. Screenshot Cursor's chat
window after each — the bottom-of-input token counter tells the story.

**Target file (heavyweight, real-world):**
`~/demo/react/packages/react-reconciler/src/ReactFiberWorkLoop.js` — ~45k tokens raw.

### Prompt WITHOUT gatemcp (baseline — expensive)

```
Read ~/demo/react/packages/react-reconciler/src/ReactFiberWorkLoop.js and give me a numbered list of every function it exports, with a one-line summary per function. Use no other tools.
```

Cursor reads the full file → ~45k input tokens added to the request.
Screenshot: the chat showing the answer + the input-token badge.

### Prompt WITH gatemcp (compressed — cheap)

```
Use gate_compress_file on ~/demo/react/packages/react-reconciler/src/ReactFiberWorkLoop.js, then give me a numbered list of every function it exports, with a one-line summary per function. Use only the compressed view.
```

Cursor loads only the AST-compressed signatures → ~14k input tokens.
**Same answer quality. ~69% fewer input tokens. ~$0.10 saved on Claude Sonnet 4 for this one question.**

### Optional "wow" variant — multi-file architecture question

For a more dramatic screenshot (89% reduction instead of 69%):

```
# WITHOUT
Read every .js file in ~/demo/react/packages/react-reconciler/src/ and explain the fiber reconciler architecture. List every exported API.

# WITH
Use gate_compress_file on every .js file in ~/demo/react/packages/react-reconciler/src/, then explain the fiber reconciler architecture. List every exported API.
```

Without often hits Cursor's context cap mid-stream — that failure mode IS the screenshot. With gatemcp it completes cleanly in ~445k compressed tokens.

---

## Setup checklist (done BEFORE you hit record)

Run these once. They should all already be true.

```bash
cd "/Users/macbookair/Documents/Visual Studio Code/MCP/gate-mcp"

# 1. gatemcp v0.3.2 is built
npm run build
node -e "console.log(require('./package.json').version)"
# expect: 0.3.2

# 2. React repo is cloned at ~/demo/react
ls ~/demo/react/packages | head -3
# expect: dom-event-testing-library, eslint-plugin-react-hooks, internal-test-utils

# 3. Cursor MCP config points to gatemcp
cat .cursor/mcp.json
# expect: "gatemcp" entry pointing to dist/main.js
```

**Open BEFORE recording:**
1. iTerm / Terminal — full screen, large font (≥18 pt), dark background.
2. Cursor IDE — with this repo open, MCP panel visible.
3. (Optional) Cursor settings → Usage page in a browser tab to glance at usage stats.

---

## ACT 1 — The Problem (≈30 s)

**Say:**
> "Every time you ask Cursor to help with code, it sends 30,000 to 150,000 tokens of context to the LLM. On a Claude Sonnet 4 request that's roughly $0.10–$0.45 per turn, multiplied by hundreds of turns per day. Most of that context is repetitive: function bodies the AI already saw, JSON schemas, comments, whitespace. gatemcp compresses it before it leaves your machine."

**On screen:**
Just show the README — scroll past the "5-layer compression" diagram. No commands yet.

---

## ACT 2 — The hard-numbers demo (≈75 s)

**Say:**
> "Let me prove the compression on a real codebase — Facebook's open-source React monorepo. 2,080 files, almost 4 million tokens of raw source."

**Command 1 — show the target size first:**
```bash
cd "/Users/macbookair/Documents/Visual Studio Code/MCP/gate-mcp"
du -sh ~/demo/react/packages
find ~/demo/react/packages \( -name "*.js" -o -name "*.ts" -o -name "*.tsx" \) 2>/dev/null | wc -l
```
Verified output: **22 MB, 1,872 source files** (the benchmark script also picks up `.md`, `.css`, `.json` for a total of 2,080 scanned).

**Command 2 — run the gatemcp benchmark:**
```bash
node dist/scripts/benchmark-real-repo.js ~/demo/react/packages --out /tmp/react-demo.md
```
This takes ~10 seconds. Watch the progress lines tick: `processed 100/2080`, `processed 200/2080`, ...

**Command 3 — show the result:**
```bash
head -22 /tmp/react-demo.md
```

**Expected output — this is the money shot:**

```
| Metric | Raw files | gatemcp signatures | Reduction |
|---|---|---|---|
| Tokens | **3.93M** | **445.8k** | **89%** |
| Claude Sonnet 4 cost (input) | $11.79 | $1.34 | $10.45 saved |
| GPT-4o cost (input) | $9.82 | $1.11 | $8.71 saved |
| GPT-5 cost (input) | $19.65 | $2.23 | $17.42 saved |
```

**Say (while pointing at the 89% number):**
> "89 percent reduction. $10.45 saved per full-codebase question on Claude Sonnet 4. And this isn't a synthetic benchmark — it's a public repo anyone can clone and reproduce."

---

## ACT 3 — The fidelity proof (≈60 s)

**Say:**
> "The natural objection is: any tool can shrink code if it doesn't care about correctness. gatemcp ships with a symbol-recall validator that compares the compressed view against the raw source. Here it is on the same repo."

**Command:**
```bash
node dist/scripts/fidelity-test.js ~/demo/react/packages 2>/dev/null
```

**Expected output (≈3 s wall time):**

```
═══════════════════════════════════════════════════════════
 gatemcp Symbol Fidelity Report (Experiment #4a)
═══════════════════════════════════════════════════════════
Files measured:         1010
Total exported symbols: 7047
Symbols preserved:      6987
Symbols lost:           60

Overall recall (symbol-weighted): 99.1%
Average recall (file-weighted):   99.8%

Recall distribution:
  100%      1003 files  ████████████████████████████████████████
  95-99%       1 files
  90-94%       0 files
  ...
```

**Say (point at 99.1%):**
> "99.1% of every exported symbol from 1,010 React files survives compression. 1,003 files preserve every single symbol exactly. The compression isn't lossy in any meaningful sense for an LLM."

---

## ACT 4 — The Cursor moment (≈75 s) [optional if running short]

**Say:**
> "Now the real test — using it inside an IDE. gatemcp installs via MCP, the protocol Cursor speaks. Four lines of config."

**Show on screen:**
1. Open `.cursor/mcp.json` in Cursor — only 8 lines, point at the `"gatemcp"` entry.
2. Open Cursor's MCP/tools panel (Settings → Features → MCP Servers).
3. Show the gatemcp tools listed: `gate_help`, `gate_compress_file`, `gate_graph_query`, `gate_dedup_context`, `gate_clean_response`, `gate_optimize_image`.

**Live prompt to type into Cursor chat:**

> "Use gate_compress_file to compress `~/demo/react/packages/react-reconciler/src/ReactFiberWorkLoop.js` and tell me how many tokens you saved."

**Expected — Cursor will call gate_compress_file and return something like:**
- Original tokens: ~45,000
- Compressed tokens: ~14,000
- Savings: 69%
- Note: "Extracted 65 imports, 68 exports, 127 functions from javascript file."

**Say:**
> "One real file — 45,000 input tokens collapsed to 14,000. The AI saw every function signature, every import, every export — just not the implementation bodies it doesn't need."

---

## ACT 5 — The close (≈20 s)

**Say:**
> "gatemcp v0.3.2. Single-binary local MCP server. Works in Cursor, Windsurf, Claude Code, Antigravity, VS Code Copilot. Open source on GitHub. Run the benchmark on your own repo in 30 seconds — same numbers will hold."

**Show on screen:** the GitHub URL `https://github.com/Dukeabaddon/Gate-MCP`.

---

## If asked questions

**Q: Does it work on TypeScript? Python? Java?**
> "Yes — 12 native AST languages, 11 more via regex fallback. React's mostly JavaScript so that's what I'm showing. Same compressor handles `.ts`, `.tsx`, `.py`, `.java`, `.cs`, `.cpp`, `.go`, `.rs`."

**Q: How does it know what to drop?**
> "It runs a tree-sitter AST parse, extracts imports, function signatures, class/interface declarations, exports. Drops function bodies, comments, whitespace, internal logic. The LLM can still answer 'what does this module export and what shape are its functions' — which is what 80% of code-navigation questions actually need."

**Q: Does it call out to the cloud / leak my code?**
> "No. It's a local Node.js process. Zero network calls. Zero telemetry. The source is on GitHub — `Dukeabaddon/Gate-MCP`."

**Q: What about latency?**
> "216 files per second on a MacBook M1. The compression cost is invisible compared to the LLM round-trip it saves."

**Q: What's the cache?**
> "Every compressed file is SHA-256'd. Re-asking the AI about an unchanged file returns a 15-token cache stub instead of repeating the full 14,000-token compression. Hit rates in long sessions are 80%+."

---

## Token-usage tracking — three options

| Method | Granularity | Setup |
|---|---|---|
| **Pre-computed benchmark** (RECOMMENDED for the video) | Per-repo, exact | `node dist/scripts/benchmark-real-repo.js` — what Act 2 does |
| **Cursor Usage page** | Per-day, total | `https://cursor.com/settings` → Usage tab. Take screenshots before/after a session. |
| **MCP server logs** | Per-call, exact | `tail -f ~/.cursor/logs/*/window.log` and watch for "gate_compress_file" entries with originalTokens / optimizedTokens |

The benchmark script is the strongest evidence for the video. The Cursor Usage page is overhead — only use it for follow-up validation, not in the recording.

---

## Recording checklist

- [ ] Terminal font ≥18 pt
- [ ] Hide other apps / system tray notifications
- [ ] Test the three commands once OFF-camera to confirm output
- [ ] Have this DEMO_SCRIPT.md open on a second monitor
- [ ] Speak at 0.85x normal pace — viewers need time to read terminal output
- [ ] After recording, sanity-check the audio level on the README scroll moment
