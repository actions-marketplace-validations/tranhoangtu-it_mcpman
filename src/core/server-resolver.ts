import { loadAllPlugins } from "./plugin-loader.js";
import {
  type ServerMetadata,
  resolveFromGitHub,
  resolveFromMcpman,
  resolveFromNpm,
  resolveFromSmithery,
} from "./registry.js";

export type SourceType = "smithery" | "npm" | "github" | string;

export interface ServerSource {
  type: SourceType;
  input: string; // normalized name/package/url
}

// Detect source type from user input (checks built-ins then plugins)
// Accepts an optional pre-loaded plugin list to avoid double loading.
export function detectSource(input: string, plugins?: ReturnType<typeof loadAllPlugins>): ServerSource {
  if (input.startsWith("smithery:")) {
    return { type: "smithery", input: input.slice(9) };
  }
  if (input.startsWith("mcpman:")) {
    return { type: "mcpman", input: input.slice(7) };
  }
  if (input.startsWith("https://github.com/") || input.startsWith("github.com/")) {
    return { type: "github", input: input };
  }

  // Check plugin prefixes — use provided list or load once
  const loadedPlugins = plugins ?? loadAllPlugins();
  for (const plugin of loadedPlugins) {
    if (input.startsWith(plugin.prefix)) {
      return { type: `plugin:${plugin.name}`, input: input.slice(plugin.prefix.length) };
    }
  }

  return { type: "npm", input };
}

// Parse --env KEY=VAL flags into a Record
export function parseEnvFlags(envFlags: string | string[] | undefined): Record<string, string> {
  if (!envFlags) return {};
  const flags = Array.isArray(envFlags) ? envFlags : [envFlags];
  const result: Record<string, string> = {};
  for (const flag of flags) {
    const idx = flag.indexOf("=");
    if (idx > 0) {
      result[flag.slice(0, idx)] = flag.slice(idx + 1);
    }
  }
  return result;
}

// Resolve server metadata from detected source.
// Loads plugins once and shares them between detectSource and resolution.
export async function resolveServer(input: string): Promise<ServerMetadata> {
  // Load plugins once to avoid double-loading between detectSource and plugin resolution
  const plugins = loadAllPlugins();
  const source = detectSource(input, plugins);
  switch (source.type) {
    case "smithery":
      return resolveFromSmithery(source.input);
    case "mcpman":
      return resolveFromMcpman(source.input);
    case "github":
      return resolveFromGitHub(source.input);
    case "npm":
      return resolveFromNpm(source.input);
    default: {
      // Plugin-based resolution: type is "plugin:<name>"
      if (source.type.startsWith("plugin:")) {
        const pluginName = source.type.slice(7);
        const plugin = plugins.find((p) => p.name === pluginName);
        if (plugin) {
          const resolved = await plugin.resolve(source.input);
          return resolved as ServerMetadata;
        }
      }
      throw new Error(`Unknown source type: ${source.type}`);
    }
  }
}
