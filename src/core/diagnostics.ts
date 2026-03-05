import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CheckResult {
  name: string;
  passed: boolean;
  skipped?: boolean;
  message: string;
  fix?: string;
}

// Re-export process checks from dedicated module
export { checkProcessSpawn, checkMcpHandshake } from "./mcp-process-checks.js";

/** Check if a runtime command is available on PATH */
export async function checkRuntime(command: string): Promise<CheckResult> {
  const locator = process.platform === "win32" ? "where" : "which";
  // Normalize: npx -> node, uvx -> python3
  const runtimeCmd = command === "npx" ? "node" : command === "uvx" ? "python3" : command;

  try {
    // Use execFileAsync with argument array to prevent shell injection
    const { stdout } = await execFileAsync(locator, [runtimeCmd]);
    const version = await getRuntimeVersion(runtimeCmd);
    return {
      name: "Runtime",
      passed: true,
      message: `${runtimeCmd}${version ? ` ${version}` : ""} (${stdout.trim()})`,
    };
  } catch {
    return {
      name: "Runtime",
      passed: false,
      message: `${runtimeCmd} not found on PATH`,
      fix: getInstallFix(runtimeCmd),
    };
  }
}

async function getRuntimeVersion(cmd: string): Promise<string> {
  try {
    // docker needs two separate args; avoid passing shell string
    const args = cmd === "docker" ? ["version", "--format", "{{.Client.Version}}"] : ["--version"];
    const { stdout } = await execFileAsync(cmd, args);
    const match = stdout.match(/\d+\.\d+[\.\d]*/);
    return match ? `v${match[0]}` : "";
  } catch {
    return "";
  }
}

function getInstallFix(cmd: string): string {
  const isMac = process.platform === "darwin";
  const isWin = process.platform === "win32";
  switch (cmd) {
    case "node":
      return isMac ? "brew install node" : isWin ? "winget install NodeJS" : "apt install nodejs";
    case "python3":
    case "python":
      return isMac
        ? "brew install python"
        : isWin
          ? "winget install Python"
          : "apt install python3";
    case "docker":
      return isMac
        ? "brew install --cask docker"
        : isWin
          ? "winget install Docker.DockerDesktop"
          : "apt install docker.io";
    default:
      return `Install ${cmd} and ensure it's on your PATH`;
  }
}

/** Check that required env vars are set and non-empty (never logs actual values) */
export function checkEnvVars(env?: Record<string, string>): CheckResult {
  if (!env || Object.keys(env).length === 0) {
    return { name: "Env vars", passed: true, message: "none required" };
  }

  const missing: string[] = [];
  const placeholder: string[] = [];
  const PLACEHOLDER_RE = /^(your[-_]|<|TODO|PLACEHOLDER|CHANGEME|xxx)/i;

  for (const [key, value] of Object.entries(env)) {
    const resolved = process.env[key] ?? value;
    if (!resolved) {
      missing.push(key);
    } else if (PLACEHOLDER_RE.test(resolved)) {
      placeholder.push(key);
    }
  }

  if (missing.length > 0) {
    return {
      name: "Env vars",
      passed: false,
      message: `missing: ${missing.join(", ")}`,
      fix: `Set environment variables: ${missing.map((k) => `${k}=<value>`).join(" ")}`,
    };
  }
  if (placeholder.length > 0) {
    return {
      name: "Env vars",
      passed: true,
      message: `may have placeholder values: ${placeholder.join(", ")} (check config)`,
    };
  }

  return { name: "Env vars", passed: true, message: `${Object.keys(env).length} var(s) set` };
}
