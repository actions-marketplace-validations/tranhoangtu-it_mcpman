/**
 * server.ts
 * MCP server entry point for mcpman.
 * Exposes mcpman functionality as MCP tools over stdio transport.
 * AI agents can install, remove, list, audit, and manage MCP servers programmatically.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { APP_VERSION } from "../utils/constants.js";
import { errorResult } from "./tool-helpers.js";
import {
  auditSchema,
  doctorSchema,
  infoSchema,
  installSchema,
  listSchema,
  removeSchema,
  searchSchema,
  statusSchema,
} from "./types.js";
import {
  handleAudit,
  handleDoctor,
  handleInfo,
  handleInstall,
  handleList,
  handleRemove,
  handleSearch,
  handleStatus,
} from "./tools.js";

/** All tool definitions exposed by this MCP server */
const TOOL_DEFINITIONS = [
  {
    name: "mcpman_install",
    description: "Resolve MCP server metadata from npm, Smithery, or GitHub. Returns info but does not write to lockfile — use CLI for full install.",
    inputSchema: installSchema,
  },
  {
    name: "mcpman_remove",
    description: "Remove an installed MCP server from the lockfile.",
    inputSchema: removeSchema,
  },
  {
    name: "mcpman_list",
    description: "List all installed MCP servers, optionally filtered by client.",
    inputSchema: listSchema,
  },
  {
    name: "mcpman_search",
    description: "Search npm and Smithery registries for MCP servers.",
    inputSchema: searchSchema,
  },
  {
    name: "mcpman_audit",
    description: "Run a security audit on installed MCP servers. Returns risk scores and vulnerabilities.",
    inputSchema: auditSchema,
  },
  {
    name: "mcpman_doctor",
    description: "Run health diagnostics on installed MCP servers (runtime, spawn, handshake checks).",
    inputSchema: doctorSchema,
  },
  {
    name: "mcpman_info",
    description: "Get detailed information about a specific MCP server (version, source, clients, command).",
    inputSchema: infoSchema,
  },
  {
    name: "mcpman_status",
    description: "Get an aggregated status summary of all installed MCP servers.",
    inputSchema: statusSchema,
  },
];

/** Create and configure the MCP server instance */
function createServer(): Server {
  const server = new Server(
    { name: "mcpman", version: APP_VERSION },
    { capabilities: { tools: {} } },
  );

  // List all available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  // Dispatch tool calls to handlers
  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name, arguments: args = {} } = request.params;
    const safeArgs = args as Record<string, unknown>;

    switch (name) {
      case "mcpman_install": return handleInstall(safeArgs);
      case "mcpman_remove":  return handleRemove(safeArgs);
      case "mcpman_list":    return handleList(safeArgs);
      case "mcpman_search":  return handleSearch(safeArgs);
      case "mcpman_audit":   return handleAudit(safeArgs);
      case "mcpman_doctor":  return handleDoctor(safeArgs);
      case "mcpman_info":    return handleInfo(safeArgs);
      case "mcpman_status":  return handleStatus(safeArgs);
      default:
        return errorResult(`Unknown tool: ${name}`);
    }
  });

  return server;
}

/** Start mcpman as an MCP server using stdio transport */
export async function startMcpServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
