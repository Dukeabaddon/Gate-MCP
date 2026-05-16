# VS Code snippets for gatemcp

Minimal helper (not an LSP): contributes JSON / JSONC snippets so you can paste an MCP config into `.vscode/mcp.json`, Cursor `.cursor/mcp.json`, or VS Code **Settings → MCP** JSON without hunting the readme.

## Install (side-load)

From the repo root:

```bash
cd vscode-extension
npm pack
code --install-extension ./vscode-gatemcp-0.1.0.tgz
```

Or use **Extensions → Install from VSIX…** and pick the `.tgz` / packaged `.vsix` after `vsce package` if you use `vsce`.

## Usage

1. Open a JSON or JSONC file (e.g. `.cursor/mcp.json`).
2. Trigger snippet **`gatemcp-mcp`** or **`gatemcp-cursor-mcp`** via IntelliSense / Insert Snippet.

## Run CLI as a task (optional)

Create `.vscode/tasks.json` in your project:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "gatemcp: MCP server (stdio)",
      "type": "shell",
      "command": "npx -y @gatemcp/cli",
      "problemMatcher": [],
      "presentation": {
        "reveal": "always",
        "panel": "dedicated"
      }
    }
  ]
}
```

Then **Tasks: Run Task → gatemcp: MCP server (stdio)**. Most MCP setups instead reference the same `npx` command in the IDE MCP settings file; this task is mainly for debugging.

## Published CLI

Package: `@gatemcp/cli` — binary `gatemcp`. Snippets use `npx -y @gatemcp/cli` so no global install is required.
