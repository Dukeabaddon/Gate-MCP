---
name: gatemcp-workflow
description: Map repositories, compress relevant files, avoid duplicate context, and report measured Gate MCP activity. Use when a coding task benefits from repository graph navigation, compact structural views, or verifiable context statistics.
---

# Gate MCP Workflow

Use Gate as an explicit context layer. Keep ordinary file reads and searches separate from Gate measurements.

## Workflow

1. Call `gate_init` once for the current repository. It activates that root for later relative paths.
2. If Graphify is available, start with `gate_graph_query` using `graphify_map`. Otherwise use graph statistics or targeted search.
3. Query symbols and paths before requesting full file bodies.
4. Use `gate_compress_file` with `signature` for code and `structure` for JSON, YAML, Markdown, and configuration files.
5. Request `full` content only when implementation details are required or Gate reports a full-content fallback.
6. For repeated unchanged content, call `gate_dedup_context` with `check`. Retrieve a usable view through `gate_compress_file` when required.
7. Finish with `gate_session_stats`. Report its `measurement_scope`. Separate measured serialized-result values from modeled graph baselines.

## Failure Handling

- If Gate tools are missing, report an installation or discovery failure. Use `rg` and normal repository tools. Never invent savings.
- If `persistentCache` is false, run `gatemcp doctor --strict` when permitted. State which fallback remains active.
- Treat a full-content fallback as zero compression savings.

## Safety

- Keep `GATE_PROJECT_ROOT` limited to the active repository.
- Never use `GATE_ALLOW_ANY_PATH` as a routine workaround.
- Enable proxy execution only after reviewing its configuration and explicitly setting `GATE_ENABLE_PROXY=1`.
- Do not attribute ordinary reads, Graphify output, or external searches to Gate compression totals.
