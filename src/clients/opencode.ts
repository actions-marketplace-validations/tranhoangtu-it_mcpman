import { resolveConfigPath } from "../utils/paths.js";
import { BaseClientHandler } from "./base-client-handler.js";
import type { ClientConfig, ClientType, ServerEntry } from "./types.js";

/**
 * OpenCode stores MCP config in JSON at ~/.config/opencode/opencode.json
 * Format: { "mcp": { "name": { "type": "local", "command": [...], "environment": {...} } } }
 * Adapter maps "command" array → command+args and "environment" → env
 */
export class OpenCodeHandler extends BaseClientHandler {
  type: ClientType = "opencode";
  displayName = "OpenCode";

  getConfigPath(): string {
    return resolveConfigPath("opencode");
  }

  protected toClientConfig(raw: Record<string, unknown>): ClientConfig {
    const mcp = (raw.mcp ?? {}) as Record<string, Record<string, unknown>>;
    const servers: Record<string, ServerEntry> = {};
    for (const [name, entry] of Object.entries(mcp)) {
      const cmdArray = (entry.command ?? []) as string[];
      if (cmdArray.length === 0) continue;
      servers[name] = {
        command: cmdArray[0],
        args: cmdArray.slice(1),
        ...(entry.environment ? { env: entry.environment as Record<string, string> } : {}),
      };
    }
    return { servers };
  }

  protected fromClientConfig(
    raw: Record<string, unknown>,
    config: ClientConfig,
  ): Record<string, unknown> {
    const existingMcp = (raw.mcp ?? {}) as Record<string, Record<string, unknown>>;
    const mcp: Record<string, Record<string, unknown>> = {};
    for (const [name, entry] of Object.entries(config.servers)) {
      // Skip entries without a command (remote/SSE entries have no command)
      if (!entry.command) continue;
      // Preserve existing enabled value; only default to true for new entries
      const existingEnabled = existingMcp[name]?.enabled;
      const enabled = existingEnabled !== undefined ? existingEnabled : true;
      mcp[name] = {
        type: "local",
        command: [entry.command, ...(entry.args ?? [])],
        enabled,
        ...(entry.env ? { environment: entry.env } : {}),
      };
    }
    // Preserve non-mcp keys
    const { mcp: _existing, ...rest } = raw;
    return { ...rest, mcp };
  }
}
