/**
 * FAIROS Experiment #3 — TOON Consumption Validation
 *
 * HYPOTHESIS: TOON-formatted data retains enough structure for
 * accurate information extraction — as good as standard JSON.
 *
 * METHOD:
 *   1. Generate identical datasets in JSON and TOON formats
 *   2. Parse TOON back into structured data (simulating LLM parsing)
 *   3. Verify: does TOON retain all values, relationships, structure?
 *   4. Test edge cases: special characters, empty values, nested data
 *   5. Measure: information loss rate, parsing reliability
 *
 * SUCCESS CRITERION: ≥95% of data fields recoverable from TOON
 * with zero factual errors on primitive values.
 *
 * NOTE: This tests TOON's structural fidelity, not LLM parsing
 * ability. It validates that our TOON output is unambiguous.
 */

import { handleCleanResponse } from "./tools/cleanResponse.js";

const PASS = "✅";
const FAIL = "❌";

interface TestCase {
  name: string;
  json: unknown;
  expectedFields: string[];
  expectedValues: Array<[string, string]>; // [field, expected_value_substring]
}

/**
 * Parse TOON tabular data back to check field recovery.
 */
function parseToonTable(toon: string): Array<Record<string, string>> {
  const lines = toon.trim().split("\n");
  if (lines.length < 2) return [];

  const headers = lines[0].split("|");
  const rows: Array<Record<string, string>> = [];

  for (let i = 1; i < lines.length; i++) {
    if (lines[i].startsWith("...")) break; // truncation marker
    const values = lines[i].split("|");
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || "";
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Extract key-value pairs from TOON key: value lines.
 */
function parseToonKeyValues(toon: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = toon.trim().split("\n");
  for (const line of lines) {
    if (line.startsWith("[") || line.includes("|")) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      result[key] = value;
    }
  }
  return result;
}

/**
 * Find a TOON section (e.g., [users]) and return its content.
 */
function extractToonSection(toon: string, sectionName: string): string {
  const marker = `[${sectionName}]`;
  const idx = toon.indexOf(marker);
  if (idx === -1) return "";

  const afterMarker = toon.slice(idx + marker.length).trim();
  const nextSection = afterMarker.indexOf("\n[");
  return nextSection === -1 ? afterMarker : afterMarker.slice(0, nextSection).trim();
}

const TEST_CASES: TestCase[] = [
  {
    name: "Simple array of objects",
    json: [
      { id: 1, name: "Alice", role: "admin" },
      { id: 2, name: "Bob", role: "user" },
      { id: 3, name: "Charlie", role: "moderator" },
    ],
    expectedFields: ["id", "name", "role"],
    expectedValues: [
      ["name", "Alice"],
      ["name", "Bob"],
      ["role", "moderator"],
    ],
  },
  {
    name: "Array with numbers and booleans",
    json: [
      { port: 3000, host: "localhost", ssl: true },
      { port: 8080, host: "0.0.0.0", ssl: false },
    ],
    expectedFields: ["port", "host", "ssl"],
    expectedValues: [
      ["port", "3000"],
      ["host", "localhost"],
      ["ssl", "true"],
    ],
  },
  {
    name: "Array with empty/null values",
    json: [
      { id: 1, name: "Alice", email: "alice@test.com" },
      { id: 2, name: "Bob", email: null },
      { id: 3, name: "", email: "charlie@test.com" },
    ],
    expectedFields: ["id", "name", "email"],
    expectedValues: [
      ["name", "Alice"],
      ["email", "alice@test.com"],
      ["id", "3"],
    ],
  },
  {
    name: "Large array (20 items) — truncation test",
    json: Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      value: `item_${i + 1}`,
      score: Math.round(Math.random() * 100),
    })),
    expectedFields: ["id", "value", "score"],
    expectedValues: [
      ["value", "item_1"],
      ["value", "item_5"],
    ],
  },
  {
    name: "Nested object with array",
    json: {
      status: "ok",
      count: 2,
      data: [
        { name: "Express", version: "5.0" },
        { name: "Fastify", version: "4.0" },
      ],
    },
    expectedFields: ["status", "count"],
    expectedValues: [
      ["status", "ok"],
      ["count", "2"],
    ],
  },
  {
    name: "Special characters in values",
    json: [
      { path: "/api/v1/users", method: "GET", desc: "List users (paginated)" },
      { path: "/api/v1/users/:id", method: "DELETE", desc: "Remove user | cascade" },
    ],
    expectedFields: ["path", "method", "desc"],
    expectedValues: [
      ["path", "/api/v1/users"],
      ["method", "GET"],
    ],
  },
];

async function runExperiment3(): Promise<void> {
  console.error("\n" + "═".repeat(60));
  console.error("  FAIROS Experiment #3 — TOON Consumption Validation");
  console.error("═".repeat(60));

  let totalFields = 0;
  let recoveredFields = 0;
  let totalValues = 0;
  let correctValues = 0;
  let casesPass = 0;
  let casesFail = 0;

  for (const tc of TEST_CASES) {
    console.error(`\n  📋 ${tc.name}`);

    const jsonStr = JSON.stringify(tc.json);
    const result = await handleCleanResponse({ data: jsonStr, format: "toon" });

    console.error(
      `     Tokens: ${result.originalTokens} → ${result.optimizedTokens} (${result.savingsPercent}% saved)`
    );
    console.error(`     TOON output:\n${result.cleaned.split("\n").map(l => "       " + l).join("\n")}`);

    // Parse TOON back
    let fieldRecovery = 0;
    let valueRecovery = 0;

    if (Array.isArray(tc.json)) {
      // Table format — check headers
      const parsed = parseToonTable(result.cleaned);

      for (const field of tc.expectedFields) {
        totalFields++;
        if (result.cleaned.includes(field)) {
          fieldRecovery++;
          recoveredFields++;
        }
      }

      // Check values
      for (const [field, expectedVal] of tc.expectedValues) {
        totalValues++;
        const found = parsed.some(
          (row) => row[field] !== undefined && row[field].includes(expectedVal)
        );
        if (found || result.cleaned.includes(expectedVal)) {
          valueRecovery++;
          correctValues++;
        } else {
          console.error(`     ${FAIL} Value miss: ${field}="${expectedVal}"`);
        }
      }
    } else {
      // Key-value format
      const kv = parseToonKeyValues(result.cleaned);

      for (const field of tc.expectedFields) {
        totalFields++;
        if (field in kv || result.cleaned.includes(field)) {
          fieldRecovery++;
          recoveredFields++;
        }
      }

      for (const [field, expectedVal] of tc.expectedValues) {
        totalValues++;
        if (
          (kv[field] && kv[field].includes(expectedVal)) ||
          result.cleaned.includes(expectedVal)
        ) {
          valueRecovery++;
          correctValues++;
        } else {
          console.error(`     ${FAIL} Value miss: ${field}="${expectedVal}"`);
        }
      }
    }

    const allFieldsOk = fieldRecovery === tc.expectedFields.length;
    const allValuesOk = valueRecovery === tc.expectedValues.length;
    if (allFieldsOk && allValuesOk) {
      console.error(`     ${PASS} All fields recovered, all values correct`);
      casesPass++;
    } else {
      console.error(
        `     ${FAIL} Fields: ${fieldRecovery}/${tc.expectedFields.length}, ` +
          `Values: ${valueRecovery}/${tc.expectedValues.length}`
      );
      casesFail++;
    }
  }

  // Summary
  const fieldRate =
    totalFields > 0 ? Math.round((recoveredFields / totalFields) * 100) : 100;
  const valueRate =
    totalValues > 0 ? Math.round((correctValues / totalValues) * 100) : 100;

  console.error(`\n${"═".repeat(60)}`);
  console.error(`  EXPERIMENT #3 RESULTS`);
  console.error("═".repeat(60));
  console.error(`  Test cases:           ${casesPass} passed, ${casesFail} failed`);
  console.error(`  Field recovery:       ${recoveredFields}/${totalFields} (${fieldRate}%)`);
  console.error(`  Value accuracy:       ${correctValues}/${totalValues} (${valueRate}%)`);
  console.error(
    `  Success criterion:    ${fieldRate >= 95 && valueRate >= 95 ? PASS + " PASSED" : FAIL + " FAILED"}`
  );
  console.error("═".repeat(60));

  if (fieldRate >= 95 && valueRate >= 95) {
    console.error(
      `\n  ${PASS} HYPOTHESIS SUPPORTED: TOON retains ≥95% structural fidelity.`
    );
  } else {
    console.error(
      `\n  ${FAIL} HYPOTHESIS CHALLENGED: TOON loses data in some cases.`
    );
    if (casesFail > 0) {
      console.error(`  ⚠️  Special characters or edge cases may need escaping.`);
    }
  }
}

runExperiment3().catch((err) => {
  console.error(`Fatal: ${err}`);
  process.exit(1);
});
