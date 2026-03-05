/**
 * tools-diagnostics.ts
 * MCP tool handlers for diagnostics: audit, doctor.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ServerEntry } from "../clients/types.js";
import { readLockfile } from "../core/lockfile.js";
import { checkServerHealth } from "../core/health-checker.js";
import { scanAllServers, scanServer } from "../core/security-scanner.js";
import { textResult, errorResult } from "./tool-helpers.js";

// ── Audit ────────────────────────────────────────────────────────────────────

export async function handleAudit(args: Record<string, unknown>): Promise<CallToolResult> {
  const serverName = args.server ? String(args.server) : undefined;

  try {
    const data = readLockfile();
    const { servers } = data;

    if (Object.keys(servers).length === 0) {
      return textResult("No MCP servers installed.");
    }

    const targets = serverName
      ? serverName in servers
        ? { [serverName]: servers[serverName] }
        : null
      : servers;

    if (!targets) {
      return errorResult(`Server '${serverName}' not found in lockfile.`);
    }

    const reports = serverName
      ? [await scanServer(serverName, targets[serverName])]
      : await scanAllServers(targets);

    // Sort by server name for deterministic output
    reports.sort((a, b) => a.server.localeCompare(b.server));

    const lines = reports.map((r) => {
      const vulnCount = r.vulnerabilities.length;
      const vulnSummary = vulnCount === 0 ? "no vulnerabilities" : `${vulnCount} vulnerability/vulnerabilities`;
      return `  ${r.server}  risk: ${r.riskLevel}  score: ${r.score ?? "N/A"}/100  ${vulnSummary}`;
    });

    const withIssues = reports.filter((r) => r.riskLevel !== "LOW" && r.riskLevel !== "UNKNOWN");
    const summary = withIssues.length === 0 ? "all clear" : `${withIssues.length} server(s) with issues`;

    return textResult(
      `Audit results (${reports.length} server(s)) — ${summary}:\n\n${lines.join("\n")}`,
    );
  } catch (err) {
    return errorResult(`Error running audit: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Doctor ───────────────────────────────────────────────────────────────────

export async function handleDoctor(args: Record<string, unknown>): Promise<CallToolResult> {
  const serverName = args.server ? String(args.server) : undefined;

  try {
    const data = readLockfile();
    const { servers } = data;

    if (Object.keys(servers).length === 0) {
      return textResult("No MCP servers installed.");
    }

    const targets = serverName
      ? serverName in servers
        ? [[serverName, servers[serverName]] as const]
        : null
      : Object.entries(servers);

    if (!targets) {
      return errorResult(`Server '${serverName}' not found in lockfile.`);
    }

    const results = await Promise.all(
      targets.map(([name, entry]) => {
        // Build env map from lockfile envVars (list of required var names)
        // Values are resolved from process.env; empty string signals "required but not set"
        const env: Record<string, string> = {};
        for (const varName of entry.envVars ?? []) {
          env[varName] = process.env[varName] ?? "";
        }
        const serverEntry: ServerEntry = {
          command: entry.command,
          args: entry.args,
          env,
          type: entry.transport as ServerEntry["type"],
          url: entry.url,
          headers: {},
        };
        return checkServerHealth(name, serverEntry);
      }),
    );

    const lines = results.map((r) => {
      const checkSummary = r.checks
        .map((c) => `    ${c.passed ? "✓" : c.skipped ? "·" : "✗"} ${c.name}: ${c.message}`)
        .join("\n");
      return `  ${r.serverName} — ${r.status}\n${checkSummary}`;
    });

    const healthy = results.filter((r) => r.status === "healthy").length;
    return textResult(
      `Doctor results (${results.length} server(s), ${healthy} healthy):\n\n${lines.join("\n\n")}`,
    );
  } catch (err) {
    return errorResult(`Error running doctor: ${err instanceof Error ? err.message : String(err)}`);
  }
}
