import fs from "node:fs";
import YAML from "yaml";
import { resolveConfigPath } from "../utils/paths.js";
import { BaseClientHandler, atomicWrite } from "./base-client-handler.js";
import type { ClientConfig, ClientType, ServerEntry } from "./types.js";
import { ConfigParseError, ConfigWriteError } from "./types.js";

/**
 * Continue stores MCP config in YAML at ~/.continue/config.yaml
 * Format: mcpServers is an array: [{ name: "x", command: "...", args: [...], env: {...} }]
 * Adapter converts between array format and Record<string, ServerEntry>
 */
export class ContinueHandler extends BaseClientHandler {
  type: ClientType = "continue";
  displayName = "Continue";

  getConfigPath(): string {
    return resolveConfigPath("continue");
  }

  protected async readRaw(): Promise<Record<string, unknown>> {
    const configPath = this.getConfigPath();
    try {
      const raw = await fs.promises.readFile(configPath, "utf-8");
      return (YAML.parse(raw) ?? {}) as Record<string, unknown>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw new ConfigParseError(configPath, err);
    }
  }

  protected async writeRaw(data: Record<string, unknown>): Promise<void> {
    const configPath = this.getConfigPath();
    try {
      await atomicWrite(configPath, YAML.stringify(data));
    } catch (err) {
      throw new ConfigWriteError(configPath, err);
    }
  }

  protected toClientConfig(raw: Record<string, unknown>): ClientConfig {
    const mcpArray = (raw.mcpServers ?? []) as Array<{ name: string } & ServerEntry>;
    // Use a Map to deduplicate by name — last entry with a given name wins
    const serverMap = new Map<string, ServerEntry>();
    for (const entry of mcpArray) {
      const { name, ...rest } = entry;
      serverMap.set(name, rest);
    }
    const servers: Record<string, ServerEntry> = Object.fromEntries(serverMap);
    return { servers };
  }

  protected fromClientConfig(
    raw: Record<string, unknown>,
    config: ClientConfig,
  ): Record<string, unknown> {
    const mcpArray = Object.entries(config.servers).map(([name, entry]) => ({
      name,
      ...entry,
    }));
    return { ...raw, mcpServers: mcpArray };
  }
}
