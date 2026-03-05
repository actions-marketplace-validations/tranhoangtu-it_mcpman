import * as p from "@clack/prompts";
import { defineCommand } from "citty";
import type { TransportType } from "../clients/types.js";
import { installRemoteServer, installServer } from "../core/installer.js";
import { findLockfile, readLockfile, resolveLockfilePath } from "../core/lockfile.js";
import { parseEnvFlags } from "../core/server-resolver.js";
import { error, info } from "../utils/logger.js";

function parseHeaders(headerFlag: string | string[] | undefined): Record<string, string> {
  return parseEnvFlags(headerFlag);
}

export default defineCommand({
  meta: {
    name: "install",
    description: "Install an MCP server into one or more AI clients",
  },
  args: {
    server: {
      type: "positional",
      description:
        "Server name or package (e.g. @modelcontextprotocol/server-github, smithery:github, mcpman:my-pkg)",
      required: false,
    },
    client: {
      type: "string",
      description:
        "Target client (claude-desktop, cursor, vscode, windsurf, claude-code, roo-code, codex-cli, opencode, continue, zed)",
    },
    env: {
      type: "string",
      description: "Environment variable KEY=VAL (can repeat)",
    },
    yes: {
      type: "boolean",
      description: "Skip confirmation prompts",
      default: false,
    },
    url: {
      type: "string",
      description: "Remote MCP server URL (HTTP/SSE transport)",
    },
    name: {
      type: "string",
      description: "Server name (required with --url)",
    },
    transport: {
      type: "string",
      description: "Transport type: http or sse (auto-detected from URL if omitted)",
    },
    header: {
      type: "string",
      description: "HTTP header KEY=VALUE for remote servers (can repeat)",
    },
  },
  async run({ args }) {
    // Remote install: --url flag
    if (args.url) {
      const serverName = args.name || args.server;
      if (!serverName) {
        error(
          "--name is required when using --url. Example: mcpman install --url https://... --name my-server",
        );
        process.exit(1);
      }
      const headers = parseHeaders(args.header);
      await installRemoteServer({
        url: args.url,
        name: serverName,
        transport: args.transport as TransportType | undefined,
        headers,
        clientFilter: args.client,
        yes: args.yes,
      });
      return;
    }

    // No server arg: restore all from lockfile
    if (!args.server) {
      await restoreFromLockfile();
      return;
    }

    // mcpman: prefix — resolved via mcpman registry (handled in server-resolver)
    // e.g. mcpman install mcpman:my-package
    await installServer(args.server, {
      client: args.client,
      env: args.env,
      yes: args.yes,
    });
  },
});

// Restore all servers from lockfile (mcpman install, no args)
async function restoreFromLockfile(): Promise<void> {
  const lockPath = findLockfile();
  if (!lockPath) {
    error("No mcpman.lock found. Run 'mcpman init' first or provide a server name.");
    process.exit(1);
  }

  const lockfile = readLockfile(lockPath);
  const entries = Object.entries(lockfile.servers);
  if (entries.length === 0) {
    info("Lockfile is empty — nothing to restore.");
    return;
  }

  p.intro(`mcpman install (restore from ${lockPath})`);
  p.log.info(`Restoring ${entries.length} server(s)...`);

  for (const [name, entry] of entries) {
    // Remote entries: restore via installRemoteServer
    if (entry.transport === "http" || entry.transport === "sse") {
      await installRemoteServer({
        url: entry.url ?? entry.resolved,
        name,
        transport: entry.transport,
        yes: true,
      });
      continue;
    }

    // Stdio entries: reconstruct install input from lockfile data
    const input =
      entry.source === "smithery"
        ? `smithery:${name}`
        : entry.source === "mcpman"
          ? `mcpman:${name}`
          : entry.source === "github"
            ? entry.resolved
            : name;

    for (const client of entry.clients) {
      await installServer(input, {
        client,
        yes: true,
      });
    }
  }

  p.outro("Restore complete.");
}
