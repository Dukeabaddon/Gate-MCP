# Troubleshooting Guide

## sharp Installation Failures

### Symptom
```
Error: Cannot find module 'sharp'
```
or
```
node-gyp rebuild failed
```

### Cause
`sharp` uses native C++ bindings via `libvips`. On some systems (especially Apple Silicon Macs), the prebuilt binaries may not match your platform.

### Solutions

**Option 1: Reinstall with platform flag**
```bash
npm install --platform=darwin --arch=arm64 sharp
# or for Intel Mac:
npm install --platform=darwin --arch=x64 sharp
```

**Option 2: Force rebuild**
```bash
npm rebuild sharp
```

**Option 3: Use jimp fallback**
Gate-MCP automatically falls back to `jimp` (pure JavaScript) if `sharp` fails to load. You'll see this log message:
```
[gate-mcp] [WARN] sharp not available — falling back to jimp
```
This fallback is fully functional but ~3-5x slower for image processing.

**Option 4: Install libvips manually (Linux)**
```bash
# Ubuntu/Debian
sudo apt-get install libvips-dev

# Fedora
sudo dnf install vips-devel

# Then reinstall
npm install sharp
```

---

## OCR Confidence Issues

### Low Confidence (<30%)

**Symptoms:**
- gate_optimize_image returns `visual_optimized` when you expected text extraction
- Note includes "OCR confidence: X% — very low"

**Common Causes:**
1. **Image is actually visual** (photo, diagram, chart) — this is correct behavior
2. **Image quality is poor** — blurry, low resolution, or heavily compressed
3. **Non-English text** — Tesseract defaults to English. Other languages may have lower confidence.
4. **Stylized/decorative fonts** — OCR struggles with non-standard typefaces

**Solutions:**
- Force text extraction: `intent: "text"` (bypasses auto-detection)
- Provide a higher-resolution image
- For non-English text, the model would need additional language packs (future enhancement)

### Medium Confidence (30-70%)

The image likely contains a mix of text and visual elements. Gate-MCP defaults to visual mode to be safe. Override with `intent: "text"` if you know the text content is what matters.

### High Confidence (>70%)

Auto-detection correctly identifies text-heavy images. No action needed.

---

## Server Crashes or Hangs

### "stdout is not a pipe" or garbled JSON output

**Cause:** Something is writing to `console.log` instead of `console.error`.

**Solution:** Gate-MCP enforces all logging through `console.error`. If you've modified the source, audit for any `console.log` calls. The logger module at `src/lib/logger.ts` should be the only output mechanism.

### Server doesn't respond to requests

**Checklist:**
1. Verify the path in your MCP config points to the **built** file: `dist/main.js` (not `src/main.ts`)
2. Ensure you ran `npm run build` after any code changes
3. Check stderr for error messages: `node dist/main.js 2>debug.log`
4. Verify Node.js >= 20: `node --version`

### Tesseract worker hangs

**Cause:** First OCR call downloads language data (~4MB). On slow connections, this may timeout.

**Solution:** Run a test first to pre-download:
```bash
npm test
```
This triggers Tesseract initialization and downloads the English language pack.

---

## Tree-sitter Parse Errors

### "tree-sitter failed for typescript"

**Cause:** Native module compilation issue, similar to sharp.

**Solutions:**
1. Rebuild native modules:
   ```bash
   npm rebuild
   ```
2. Ensure build tools are installed:
   ```bash
   # macOS
   xcode-select --install
   
   # Linux
   sudo apt-get install build-essential
   ```

Gate-MCP falls back to regex-based signature extraction when tree-sitter fails. This is less accurate but functional.

---

## IDE-Specific Issues

### Cursor
- Config location: `.cursor/mcp.json` in project root
- Restart Cursor after config changes
- Check: Settings → MCP → verify "gate" appears

### Windsurf
- Config location: `~/.codeium/windsurf/mcp_config.json`
- Uses same JSON structure as Cursor

### Antigravity
- Config location: `.antigravity/mcp.json` in project root
- **CRITICAL:** Set `DISABLE_CONSOLE_OUTPUT: "true"` in env to prevent log interference
- Antigravity is extra sensitive to stdout pollution

### Claude Code
- Config location: `~/.claude/mcp.json`
- Restart Claude Code after config changes

### VS Code Copilot
- Config location: `.vscode/mcp.json` in project root
- Uses `"servers"` key (not `"mcpServers"`)
- Requires VS Code with MCP support enabled

---

## Performance Optimization

### Image processing is slow
- Ensure `sharp` is installed (5-10x faster than jimp fallback)
- First OCR call is slower (Tesseract worker initialization)
- Subsequent calls reuse the worker

### File compression is slow
- Tree-sitter parse is fast (<50ms for typical files)
- If tree-sitter fails, regex fallback is used (still fast)
- Very large files (>10K lines) may take longer for token counting

### Memory usage
- Tesseract worker: ~50-100MB (loaded once, reused)
- Tree-sitter parsers: ~5-10MB each (loaded once, cached)
- sharp: minimal additional memory
- Total: expect ~150-200MB baseline

<!-- Last reviewed: 2026-05-15 — content still accurate as of v0.3.2 release. -->
