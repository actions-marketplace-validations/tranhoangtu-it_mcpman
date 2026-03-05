/**
 * team-service.ts
 * CRUD operations for mcpman team collaboration.
 * Team config stored in .mcpman/team.json relative to project CWD (git-tracked).
 * Audit log stored in .mcpman/team-audit.json (optionally git-ignored).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TeamAuditEntry, TeamConfig, TeamRole, TeamServerEntry } from "./team-types.js";
import { readLockfile, writeLockfile } from "./lockfile.js";

export const TEAM_DIR = ".mcpman";
export const TEAM_FILE = "team.json";
export const AUDIT_FILE = "team-audit.json";

// ── Path helpers ──────────────────────────────────────────────────────────────

function teamDir(dir?: string): string {
  return path.join(dir ?? process.cwd(), TEAM_DIR);
}

function teamFilePath(dir?: string): string {
  return path.join(teamDir(dir), TEAM_FILE);
}

function auditFilePath(dir?: string): string {
  return path.join(teamDir(dir), AUDIT_FILE);
}

// ── Read / Write ──────────────────────────────────────────────────────────────

export function readTeamConfig(dir?: string): TeamConfig | null {
  const filePath = teamFilePath(dir);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as TeamConfig;
  } catch {
    return null;
  }
}

export function writeTeamConfig(config: TeamConfig, dir?: string): void {
  const dirPath = teamDir(dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  const filePath = teamFilePath(dir);
  const updated = { ...config, updatedAt: new Date().toISOString() };
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(updated, null, 2) + "\n", "utf-8");
  fs.renameSync(tmp, filePath);
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initTeam(name: string, dir?: string): TeamConfig {
  const now = new Date().toISOString();
  const actor = os.userInfo().username;
  const config: TeamConfig = {
    name,
    members: [{ name: actor, role: "admin", addedAt: now }],
    servers: {},
    createdAt: now,
    updatedAt: now,
  };
  writeTeamConfig(config, dir);
  appendAudit({ actor, action: "add_member", target: actor, details: "init" }, dir);
  return config;
}

// ── Members ───────────────────────────────────────────────────────────────────

export function addMember(name: string, role: TeamRole, dir?: string): void {
  const config = readTeamConfig(dir);
  if (!config) throw new Error("Team config not found. Run `mcpman team init <name>` first.");
  const existing = config.members.find((m) => m.name === name);
  if (existing) {
    existing.role = role;
  } else {
    config.members.push({ name, role, addedAt: new Date().toISOString() });
  }
  writeTeamConfig(config, dir);
  appendAudit({ actor: os.userInfo().username, action: "add_member", target: name, details: role }, dir);
}

export function removeMember(name: string, dir?: string): void {
  const config = readTeamConfig(dir);
  if (!config) throw new Error("Team config not found.");
  config.members = config.members.filter((m) => m.name !== name);
  writeTeamConfig(config, dir);
  appendAudit({ actor: os.userInfo().username, action: "remove_member", target: name }, dir);
}

// ── Servers ───────────────────────────────────────────────────────────────────

export function addTeamServer(serverName: string, entry: TeamServerEntry, dir?: string): void {
  const config = readTeamConfig(dir);
  if (!config) throw new Error("Team config not found.");
  config.servers[serverName] = entry;
  writeTeamConfig(config, dir);
  appendAudit({ actor: os.userInfo().username, action: "add_server", target: serverName }, dir);
}

export function removeTeamServer(serverName: string, dir?: string): void {
  const config = readTeamConfig(dir);
  if (!config) throw new Error("Team config not found.");
  delete config.servers[serverName];
  writeTeamConfig(config, dir);
  appendAudit({ actor: os.userInfo().username, action: "remove_server", target: serverName }, dir);
}

// ── Sync: team → local lockfile ───────────────────────────────────────────────

export function syncTeamToLocal(dir?: string): { added: string[]; updated: string[]; removed: string[] } {
  const config = readTeamConfig(dir);
  if (!config) throw new Error("Team config not found.");

  const lockfile = readLockfile();
  const result = { added: [] as string[], updated: [] as string[], removed: [] as string[] };

  for (const [name, entry] of Object.entries(config.servers)) {
    const existing = lockfile.servers[name];
    const lockEntry = {
      version: "team",
      source: "local" as const,
      resolved: entry.url ?? entry.command ?? name,
      integrity: "",
      runtime: "node" as const,
      command: entry.command ?? "",
      args: entry.args ?? [],
      envVars: Object.keys(entry.env ?? {}),
      installedAt: new Date().toISOString(),
      clients: [],
      transport: entry.type,
      url: entry.url,
    };
    if (!existing) {
      lockfile.servers[name] = lockEntry;
      result.added.push(name);
    } else {
      lockfile.servers[name] = { ...existing, ...lockEntry };
      result.updated.push(name);
    }
  }

  writeLockfile(lockfile);
  appendAudit({ actor: os.userInfo().username, action: "sync", target: config.name }, dir);
  return result;
}

// ── Share: local lockfile → team config ───────────────────────────────────────

export function shareLocalToTeam(serverNames: string[], dir?: string): void {
  const config = readTeamConfig(dir);
  if (!config) throw new Error("Team config not found.");

  const lockfile = readLockfile();
  for (const name of serverNames) {
    const entry = lockfile.servers[name];
    if (!entry) continue;
    config.servers[name] = {
      command: entry.command || undefined,
      args: entry.args.length ? entry.args : undefined,
      type: entry.transport,
      url: entry.url,
    };
  }

  writeTeamConfig(config, dir);
  appendAudit({ actor: os.userInfo().username, action: "share", target: serverNames.join(", ") }, dir);
}

// ── Audit ─────────────────────────────────────────────────────────────────────

export function getAuditLog(dir?: string): TeamAuditEntry[] {
  const filePath = auditFilePath(dir);
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as TeamAuditEntry[];
  } catch {
    return [];
  }
}

function appendAudit(entry: Omit<TeamAuditEntry, "timestamp">, dir?: string): void {
  const filePath = auditFilePath(dir);
  const dirPath = teamDir(dir);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  try {
    // Read current log inside the try block so a read error is also caught
    const log = getAuditLog(dir);
    log.push({ ...entry, timestamp: new Date().toISOString() });
    // Write atomically via temp file + rename to avoid partial writes
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(log, null, 2) + "\n", "utf-8");
    fs.renameSync(tmp, filePath);
  } catch {
    // Audit failures must never block primary operations
  }
}
