#!/usr/bin/env node
/**
 * Mock MCP server — test fixture for proxy mode.
 *
 * Runs as a standalone stdio MCP server with three deterministic tools so
 * the proxy integration tests in src/test.ts can spawn it and exercise
 * spawn → list → call → close without touching the network or any real
 * external MCP server (GitHub, Postgres, etc.).
 *
 * Not shipped in the published npm tarball — see package.json "files".
 *
 * Tools:
 *   echo(message)            → echoes its input as plain text
 *   add(a, b)                → arithmetic; returns "{result: a+b}" as JSON
 *   make_json_list(count)    → returns an array of uniform objects, so
 *                              proxyTools can exercise TOON compression
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "gatemcp-mock",
  version: "0.5.0",
});

server.registerTool(
  "echo",
  {
    title: "Echo",
    description:
      "Echo back the input message. Used by gatemcp proxy tests to validate the request/response round-trip.",
    inputSchema: z.object({
      message: z.string().describe("Text to echo back verbatim"),
    }),
  },
  async (args) => ({
    content: [{ type: "text", text: String(args.message ?? "") }],
  })
);

server.registerTool(
  "add",
  {
    title: "Add",
    description: "Add two integers and return the sum as JSON.",
    inputSchema: z.object({
      a: z.number().describe("First addend"),
      b: z.number().describe("Second addend"),
    }),
  },
  async (args) => ({
    content: [
      {
        type: "text",
        text: JSON.stringify({ result: (args.a ?? 0) + (args.b ?? 0) }),
      },
    ],
  })
);

server.registerTool(
  "sleep",
  {
    title: "Sleep",
    description:
      "Sleep for the given number of milliseconds (used to test proxy timeout handling).",
    inputSchema: z.object({
      ms: z.number().min(0).max(60_000).describe("Sleep duration in ms (0-60000)"),
    }),
  },
  async (args) => {
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, Math.min(60_000, args.ms ?? 0)))
    );
    return {
      content: [{ type: "text", text: JSON.stringify({ slept: args.ms ?? 0 }) }],
    };
  }
);

server.registerTool(
  "make_json_list",
  {
    title: "Make JSON List",
    description:
      "Generate an array of uniform objects to exercise TOON compression in the proxy layer.",
    inputSchema: z.object({
      count: z
        .number()
        .min(1)
        .max(100)
        .describe("Number of objects to include in the response (1-100)"),
    }),
  },
  async (args) => {
    const n = Math.max(1, Math.min(100, args.count ?? 5));
    const rows = Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      label: `item-${i + 1}`,
      score: Math.round(Math.random() * 1000) / 10,
      active: i % 2 === 0,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(rows) }],
    };
  }
);

const transport = new StdioServerTransport();
server.connect(transport).catch((err) => {
  console.error(`mock-mcp-server fatal: ${err}`);
  process.exit(1);
});
