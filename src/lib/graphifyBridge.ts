/**
 * Read graphify-out/GRAPH_REPORT.md for repo map queries (complements tree-sitter symbol graph).
 */

import fs from "node:fs";
import { findGraphifyReport } from "./projectRoot.js";

export interface GraphifyHub {
  name: string;
  edges: number;
}

export interface GraphifyCommunityHit {
  id: string;
  title: string;
  snippet: string;
}

export interface GraphifyParseResult {
  reportPath: string;
  title: string;
  godNodes: GraphifyHub[];
  communityLines: string[];
  rawSummary: string;
}

export function loadGraphifyReport(reportPath: string): GraphifyParseResult {
  const text = fs.readFileSync(reportPath, "utf8");
  const titleMatch = text.match(/^#\s*Graph Report\s*-\s*(.+?)\s*\(/m);
  const title = titleMatch?.[1]?.trim() ?? "graphify";

  const godNodes: GraphifyHub[] = [];
  const godSection = text.match(/## God Nodes[\s\S]*?(?=\n## |\n---|\Z)/);
  if (godSection) {
    const re = /^\d+\.\s*`([^`]+)`\s*-\s*(\d+)\s*edges?/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(godSection[0])) !== null) {
      godNodes.push({ name: m[1], edges: parseInt(m[2], 10) });
    }
  }

  const communityLines: string[] = [];
  const commSection = text.match(/## Community Hubs[\s\S]*?(?=\n## God|\n## Surprising|\Z)/);
  if (commSection) {
    for (const line of commSection[0].split("\n")) {
      if (line.includes("Community")) communityLines.push(line.trim());
    }
  }

  const summaryMatch = text.match(/## Summary[\s\S]*?(?=\n## )/);
  const rawSummary = summaryMatch?.[0]?.trim() ?? "";

  return { reportPath, title, godNodes, communityLines, rawSummary };
}

export function queryGraphifyFromRoot(
  codeRoot: string,
  query: string,
  mode: "graphify_hubs" | "graphify_search" | "graphify_map"
): { found: boolean; result: string; reportPath?: string } {
  const reportPath = findGraphifyReport(codeRoot);
  if (!reportPath) {
    return {
      found: false,
      result:
        `No graphify-out/GRAPH_REPORT.md found from ${codeRoot}. ` +
        `Run graphify update . in your code folder or set GATE_GRAPHIFY_REPORT.`,
    };
  }

  const parsed = loadGraphifyReport(reportPath);
  const q = query.trim().toLowerCase();

  switch (mode) {
    case "graphify_hubs": {
      const lines = [
        `// graphify map: ${parsed.title}`,
        `// report: ${reportPath}`,
        "",
        "## God nodes (most connected)",
        ...parsed.godNodes.slice(0, 15).map((h, i) => `${i + 1}. ${h.name} (${h.edges} edges)`),
      ];
      return { found: true, result: lines.join("\n"), reportPath };
    }

    case "graphify_map": {
      const lines = [
        `// graphify map: ${parsed.title}`,
        parsed.rawSummary,
        "",
        "## Community hubs (sample)",
        ...parsed.communityLines.slice(0, 20),
        parsed.communityLines.length > 20
          ? `// ... ${parsed.communityLines.length - 20} more — use graphify_search`
          : "",
      ].filter(Boolean);
      return { found: true, result: lines.join("\n"), reportPath };
    }

    case "graphify_search":
    default: {
      if (!q) {
        return { found: true, result: queryGraphifyFromRoot(codeRoot, "", "graphify_map").result, reportPath };
      }

      const hubHits = parsed.godNodes.filter((h) => h.name.toLowerCase().includes(q));
      const commHits = parsed.communityLines.filter((l) => l.toLowerCase().includes(q));

      const body: string[] = [
        `// graphify search: "${query}"`,
        `// report: ${reportPath}`,
        "",
      ];

      if (hubHits.length) {
        body.push(`God nodes (${hubHits.length}):`);
        for (const h of hubHits.slice(0, 15)) {
          body.push(`  - ${h.name} (${h.edges} edges)`);
        }
      }

      if (commHits.length) {
        body.push(`Communities (${commHits.length}):`);
        for (const c of commHits.slice(0, 15)) {
          body.push(`  ${c}`);
        }
      }

      if (!hubHits.length && !commHits.length) {
        const sectionHits: string[] = [];
        for (const line of parsed.rawSummary.split("\n")) {
          if (line.toLowerCase().includes(q)) sectionHits.push(line);
        }
        if (sectionHits.length) {
          body.push("Summary lines:");
          body.push(...sectionHits.slice(0, 10).map((l) => `  ${l}`));
        } else {
          body.push(
            `No graphify hub/community match for "${query}". ` +
              `Try symbol search (queryType search) or god node names like OrderManager.`
          );
        }
      }

      return { found: hubHits.length + commHits.length > 0, result: body.join("\n"), reportPath };
    }
  }
}
