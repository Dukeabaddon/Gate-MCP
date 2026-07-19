#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const temporaryRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "gatemcp-production-regression-"),
);
const cachePath = path.join(temporaryRoot, ".gate-mcp", "cache.db");

process.env.GATE_PROJECT_ROOT = temporaryRoot;
process.env.GATE_CACHE_DB = cachePath;
process.env.DISABLE_CONSOLE_OUTPUT = "true";

const { handleCompressFile } = await import("../dist/tools/compressFile.js");
const { handleDedupContext } = await import("../dist/tools/dedupContext.js");
const { handleMemory } = await import("../dist/tools/memory.js");
const { handleSessionStats } = await import("../dist/tools/sessionStats.js");
const { safeResolveExistingFile } = await import("../dist/lib/pathGuard.js");
const { countTextTokens } = await import("../dist/lib/tokenCounter.js");
const { _resetMemoryDbForTests } = await import("../dist/lib/memoryDb.js");
const { _resetSessionMeasurementsForTests } = await import(
  "../dist/lib/sessionMetrics.js"
);
const { closeCacheDb } = await import("../dist/lib/cacheDb.js");

const results = [];

async function regression(name, run) {
  const startedAt = performance.now();
  try {
    const evidence = await run();
    results.push({
      name,
      status: "PASS",
      elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
      evidence,
    });
  } catch (error) {
    results.push({
      name,
      status: "FAIL",
      elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
      evidence: error instanceof Error ? error.message : String(error),
    });
  }
}

function write(relativePath, content) {
  const target = path.join(temporaryRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
  return target;
}

await regression("compression depth cache isolation", async () => {
  await handleDedupContext({ action: "clear" });
  const source = [
    'import { readFile } from "node:fs";',
    "export interface DepthSentinel { value: number }",
    ...Array.from(
      { length: 85 },
      (_, index) =>
        `export function depthFunction${index}(value: number): number { return value + ${index}; }`,
    ),
    "export const depthTailSentinel = readFile;",
  ].join("\n");
  const filePath = write("depth/cache-target.ts", source);

  const signature = await handleCompressFile({ filePath, depth: "signature" });
  const summary = await handleCompressFile({ filePath, depth: "summary" });

  assert.equal(signature.type, "signature");
  assert.equal(summary.type, "summary");
  assert.notEqual(summary.language, "cached", "summary reused another depth's cache row");
  assert.doesNotMatch(summary.note, /\[DEDUP\]/, "first summary call was a false cache hit");
  assert.match(summary.content, /First 50 lines/, "summary payload is not a summary");
  assert.notEqual(summary.content, signature.content, "different depths returned identical payloads");
  return {
    signatureTokens: signature.optimizedTokens,
    summaryTokens: summary.optimizedTokens,
  };
});

await regression("nested JSON structure fidelity", async () => {
  await handleDedupContext({ action: "clear" });
  const filePath = write(
    "json/nested.json",
    JSON.stringify(
      {
        account: {
          profile: {
            displayName: "Ada",
            preferences: { locale: "en-PH", colorScheme: "dark" },
          },
          billing: {
            address: { city: "Manila", postalCode: "1000" },
          },
        },
      },
      null,
      2,
    ),
  );

  const result = await handleCompressFile({ filePath, depth: "structure" });
  for (const key of [
    "account",
    "profile",
    "displayName",
    "preferences",
    "locale",
    "colorScheme",
    "billing",
    "address",
    "city",
    "postalCode",
  ]) {
    assert.ok(result.content.includes(key), `nested structure omitted key: ${key}`);
  }
  return { output: result.content };
});

await regression("project A/B memory isolation", async () => {
  _resetMemoryDbForTests();
  const projectA = path.join(temporaryRoot, "memory", "project-a");
  const projectB = path.join(temporaryRoot, "memory", "project-b");
  fs.mkdirSync(projectA, { recursive: true });
  fs.mkdirSync(projectB, { recursive: true });

  await handleMemory({
    action: "write",
    key: "shared-key",
    value: "value-from-project-a",
    projectRoot: projectA,
  });
  await handleMemory({
    action: "write",
    key: "shared-key",
    value: "value-from-project-b",
    projectRoot: projectB,
  });

  const readA = await handleMemory({
    action: "read",
    key: "shared-key",
    projectRoot: projectA,
  });
  const readB = await handleMemory({
    action: "read",
    key: "shared-key",
    projectRoot: projectB,
  });
  assert.equal(readA.value, "value-from-project-a");
  assert.equal(readB.value, "value-from-project-b");
  assert.notEqual(readA.backend, readB.backend, "projects resolved to one storage location");
  return { projectA: readA.backend, projectB: readB.backend };
});

await regression("symlink escape rejection", async () => {
  const boundary = path.join(temporaryRoot, "symlink", "project");
  const outside = path.join(temporaryRoot, "symlink", "outside");
  fs.mkdirSync(boundary, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  const secret = path.join(outside, "secret.txt");
  const link = path.join(boundary, "inside-link.txt");
  fs.writeFileSync(secret, "outside-boundary-secret", "utf8");
  fs.symlinkSync(secret, link);

  assert.throws(
    () => safeResolveExistingFile(link, { projectRoot: boundary, caller: "regression" }),
    /outside project boundary|symlink/i,
    "a symlink inside the root resolved to a file outside the root",
  );
  return { boundary, link, target: fs.realpathSync(link) };
});

await regression("full serialized-result metrics reconciliation", async () => {
  await handleDedupContext({ action: "clear" });
  _resetSessionMeasurementsForTests();
  const filePath = write(
    "metrics/serialized.ts",
    [
      'import path from "node:path";',
      "export function serializedMetricSentinel(input: string): string {",
      "  return path.resolve(input);",
      "}",
    ].join("\n"),
  );
  const result = await handleCompressFile({ filePath, depth: "signature" });
  const stats = await handleSessionStats();
  const serialized = JSON.stringify(result, null, 2);
  const serializedBytes = Buffer.byteLength(serialized, "utf8");
  const serializedTokens = countTextTokens(serialized);

  assert.equal(stats.files_considered, 1);
  assert.equal(stats.files_compressed, 1);
  assert.equal(stats.input_bytes, fs.statSync(filePath).size);
  assert.equal(
    stats.output_bytes,
    serializedBytes,
    "output_bytes measured only content, not the serialized tool result",
  );
  assert.equal(
    stats.estimated_tokens_after,
    serializedTokens,
    "estimated_tokens_after did not measure the serialized tool result",
  );
  return {
    reportedBytes: stats.output_bytes,
    serializedBytes,
    reportedTokens: stats.estimated_tokens_after,
    serializedTokens,
  };
});

await regression("dedup payload honesty", async () => {
  await handleDedupContext({ action: "clear" });
  const filePath = write(
    "dedup/payload.ts",
    "export function dedupPayloadSentinel(): string { return 'payload'; }\n",
  );
  const compressedContent = "// compressed payload\nexport function dedupPayloadSentinel(): string;";
  await handleDedupContext({
    action: "store",
    filePath,
    content: compressedContent,
    originalTokens: 500,
  });
  const hit = await handleDedupContext({ action: "check", filePath });
  assert.equal(hit.status, "cache_hit");

  const actualPayloadTokens = countTextTokens(JSON.stringify(hit));
  assert.equal(
    hit.dedupTokens,
    actualPayloadTokens,
    "dedupTokens described a tiny stub while returning a larger serialized payload",
  );
  const honestSavings = Math.max(
    0,
    Math.round(((500 - actualPayloadTokens) / 500) * 100),
  );
  assert.equal(hit.savingsPercent, honestSavings);
  return {
    reportedDedupTokens: hit.dedupTokens,
    actualPayloadTokens,
    includesCachedContent: typeof hit.content === "string",
  };
});

await regression("unsupported language fallback behavior", async () => {
  await handleDedupContext({ action: "clear" });
  const genericPath = write(
    "fallback/generic.unknownext",
    "function fallbackSentinel(value) { return value; }\n",
  );
  const generic = await handleCompressFile({ filePath: genericPath, depth: "signature" });
  assert.equal(generic.language, "unknown");
  assert.match(generic.content, /fallbackSentinel/);

  const opaquePath = write(
    "fallback/module.wat",
    [
      "(module",
      '  (func $opaque_sentinel (result i32) i32.const 42)',
      '  (export "opaque_sentinel" (func $opaque_sentinel))',
      ")",
    ].join("\n"),
  );
  const opaque = await handleCompressFile({ filePath: opaquePath, depth: "signature" });
  if (opaque.content.includes("No structural signatures detected")) {
    assert.equal(
      opaque.savingsPercent,
      0,
      "unsupported empty outline claimed meaningful compression savings",
    );
    assert.equal(
      opaque.optimizedTokens,
      opaque.originalTokens,
      "unsupported empty outline should fall back to the full source",
    );
  } else {
    assert.match(opaque.content, /opaque_sentinel/);
  }
  return {
    genericLanguage: generic.language,
    genericPreserved: generic.content.includes("fallbackSentinel"),
    opaqueNote: opaque.note,
    opaqueSavingsPercent: opaque.savingsPercent,
  };
});

await regression("reasonable large-file behavior", async () => {
  await handleDedupContext({ action: "clear" });
  const records = Array.from({ length: 12_000 }, (_, index) => ({
    id: index,
    name: `production-record-${index}`,
    enabled: index % 2 === 0,
    nested: { bucket: index % 50, checksum: `checksum-${index}` },
  }));
  const filePath = write(
    "large/records.json",
    JSON.stringify({ schemaVersion: 1, records }, null, 2),
  );
  const inputBytes = fs.statSync(filePath).size;
  assert.ok(inputBytes >= 1_000_000, `large fixture is only ${inputBytes} bytes`);

  const startedAt = performance.now();
  const result = await handleCompressFile({ filePath, depth: "structure" });
  const elapsedMs = performance.now() - startedAt;
  const outputBytes = Buffer.byteLength(result.content, "utf8");

  assert.ok(elapsedMs < 10_000, `large-file compression took ${elapsedMs.toFixed(2)}ms`);
  assert.ok(outputBytes < 262_144, `large-file output was ${outputBytes} bytes`);
  assert.ok(result.optimizedTokens < result.originalTokens);
  assert.equal(result.expanded, false);
  return {
    inputBytes,
    outputBytes,
    originalTokens: result.originalTokens,
    optimizedTokens: result.optimizedTokens,
    elapsedMs: Math.round(elapsedMs * 100) / 100,
  };
});

const failed = results.filter((result) => result.status === "FAIL");
process.stdout.write(`${JSON.stringify({ results, summary: {
  passed: results.length - failed.length,
  failed: failed.length,
  total: results.length,
}}, null, 2)}\n`);

_resetMemoryDbForTests();
closeCacheDb();

const resolvedTemporaryRoot = fs.realpathSync(temporaryRoot);
const resolvedOsTemporaryRoot = fs.realpathSync(os.tmpdir());
const temporaryRelativePath = path.relative(
  resolvedOsTemporaryRoot,
  resolvedTemporaryRoot,
);
assert.ok(
  temporaryRelativePath.length > 0 &&
    !path.isAbsolute(temporaryRelativePath) &&
    temporaryRelativePath !== ".." &&
    !temporaryRelativePath.startsWith(`..${path.sep}`),
  `refusing cleanup outside OS temp: ${resolvedTemporaryRoot}`,
);
fs.rmSync(resolvedTemporaryRoot, { recursive: true, force: true });

if (failed.length > 0) process.exitCode = 1;
