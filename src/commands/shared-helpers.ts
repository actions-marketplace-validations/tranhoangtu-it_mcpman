/**
 * shared-helpers.ts
 * Shared utilities for commands: vault secret loading, client display names,
 * and table-formatting helpers (pad, truncate).
 */

import pc from "picocolors";
import { getMasterPassword, getSecretsForServer, listSecrets } from "../core/vault-service.js";

// ── Client display names ──────────────────────────────────────────────────────

/** Human-readable display name for each supported client type. */
export const CLIENT_DISPLAY: Record<string, string> = {
  "claude-desktop": "Claude Desktop",
  cursor: "Cursor",
  vscode: "VS Code",
  windsurf: "Windsurf",
  "claude-code": "Claude Code",
  "roo-code": "Roo Code",
  "codex-cli": "Codex CLI",
  opencode: "OpenCode",
  continue: "Continue",
  zed: "Zed",
};

// ── Table formatting ──────────────────────────────────────────────────────────

/** Pad string to fixed width (left-aligned). */
export function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

/** Truncate string to max length, appending ellipsis if needed. */
export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// ── Vault helpers ─────────────────────────────────────────────────────────────

/**
 * Attempt to load vault secrets for a server.
 * Returns {} silently on any error (missing vault, no secrets, wrong password).
 * Only prompts for master password if the server has stored vault entries.
 */
export async function loadVaultSecrets(serverName: string): Promise<Record<string, string>> {
  try {
    const entries = listSecrets(serverName);
    if (entries.length === 0 || entries[0].keys.length === 0) return {};
    const password = await getMasterPassword();
    return getSecretsForServer(serverName, password);
  } catch {
    // Warn but continue — vault secrets are optional
    console.warn(pc.yellow("  Warning: Could not load vault secrets, continuing without them."));
    return {};
  }
}
