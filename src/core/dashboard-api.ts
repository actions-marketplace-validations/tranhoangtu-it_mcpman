/**
 * dashboard-api.ts
 * Local HTTP API server for the mcpman embedded dashboard.
 * Uses only node:http — no third-party HTTP frameworks.
 */

import http from "node:http";
import { URL } from "node:url";
import { getAllClientTypes } from "../clients/client-detector.js";
import type { ClientType } from "../clients/types.js";
import { checkServerHealth } from "./health-checker.js";
import { readLockfile } from "./lockfile.js";
import { scanAllServers } from "./security-scanner.js";

export interface DashboardServerInfo {
  name: string;
  version: string;
  source: string;
  runtime: string;
  clients: string[];
  transport?: string;
  url?: string;
  status?: "healthy" | "degraded" | "unhealthy" | "unknown";
}

// In-memory cache entries
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

// Mutable cache holders
let _healthCache: CacheEntry<unknown> | null = null;
let _auditCache: CacheEntry<unknown> | null = null;

function isCacheFresh(entry: CacheEntry<unknown> | null): boolean {
  return entry !== null && Date.now() < entry.expiresAt;
}

function jsonResponse(
  res: http.ServerResponse,
  data: unknown,
  status = 200,
): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

function corsHeaders(res: http.ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// GET /api/servers — list all servers from lockfile
async function handleGetServers(res: http.ServerResponse): Promise<void> {
  const lock = readLockfile();
  const servers: DashboardServerInfo[] = Object.entries(lock.servers).map(
    ([name, entry]) => ({
      name,
      version: entry.version,
      source: entry.source,
      runtime: entry.runtime,
      clients: entry.clients,
      transport: entry.transport,
      url: entry.url,
    }),
  );
  jsonResponse(res, servers);
}

// GET /api/servers/:name — single server detail
async function handleGetServer(
  res: http.ServerResponse,
  name: string,
): Promise<void> {
  const lock = readLockfile();
  const entry = lock.servers[name];
  if (!entry) {
    jsonResponse(res, { error: `Server '${name}' not found` }, 404);
    return;
  }
  jsonResponse(res, { name, ...entry });
}

// GET /api/clients — list detected clients and config status
async function handleGetClients(res: http.ServerResponse): Promise<void> {
  const allTypes = getAllClientTypes();
  const { getClient } = await import("../clients/client-detector.js");

  const results = await Promise.all(
    allTypes.map(async (type: ClientType) => {
      const handler = getClient(type);
      const installed = await handler.isInstalled();
      let serverCount = 0;
      if (installed) {
        try {
          const cfg = await handler.readConfig();
          serverCount = Object.keys(cfg.servers).length;
        } catch {
          // ignore read errors
        }
      }
      return {
        type,
        displayName: handler.displayName,
        installed,
        serverCount,
        configPath: handler.getConfigPath(),
      };
    }),
  );
  jsonResponse(res, results);
}

// GET /api/health — health checks (cached 30s)
async function handleGetHealth(res: http.ServerResponse): Promise<void> {
  if (isCacheFresh(_healthCache)) {
    jsonResponse(res, _healthCache!.data);
    return;
  }

  const lock = readLockfile();
  const results = await Promise.all(
    Object.entries(lock.servers).map(async ([name, entry]) => {
      const serverEntry = {
        command: entry.command,
        args: entry.args,
        transport: entry.transport,
        url: entry.url,
      };
      try {
        const result = await checkServerHealth(name, serverEntry);
        return result;
      } catch {
        return { serverName: name, status: "unknown", checks: [] };
      }
    }),
  );

  _healthCache = { data: results, expiresAt: Date.now() + 30_000 };
  jsonResponse(res, results);
}

// GET /api/audit — security audit (cached 60s)
async function handleGetAudit(res: http.ServerResponse): Promise<void> {
  if (isCacheFresh(_auditCache)) {
    jsonResponse(res, _auditCache!.data);
    return;
  }

  const lock = readLockfile();
  try {
    const reports = await scanAllServers(lock.servers);
    _auditCache = { data: reports, expiresAt: Date.now() + 60_000 };
    jsonResponse(res, reports);
  } catch (err) {
    jsonResponse(res, { error: String(err) }, 500);
  }
}

// GET /api/status — summary stats
async function handleGetStatus(res: http.ServerResponse): Promise<void> {
  const lock = readLockfile();
  const servers = Object.entries(lock.servers);
  const bySource: Record<string, number> = {};
  const byClient: Record<string, number> = {};

  for (const [, entry] of servers) {
    bySource[entry.source] = (bySource[entry.source] ?? 0) + 1;
    for (const client of entry.clients) {
      byClient[client] = (byClient[client] ?? 0) + 1;
    }
  }

  jsonResponse(res, {
    total: servers.length,
    bySource,
    byClient,
  });
}

// GET / — HTML placeholder
function handleRoot(res: http.ServerResponse, serverCount: number): void {
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>mcpman dashboard</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f172a;color:#e2e8f0;}
.card{text-align:center;padding:2rem;border:1px solid #334155;border-radius:12px;background:#1e293b;}
h1{color:#38bdf8;margin:0 0 1rem;}p{color:#94a3b8;margin:.5rem 0;}</style>
</head>
<body><div class="card">
<h1>mcpman dashboard</h1>
<p>Dashboard UI — coming soon</p>
<p>${serverCount} server${serverCount !== 1 ? "s" : ""} managed</p>
<p style="margin-top:1.5rem;font-size:.85em;">API available at <code>/api/servers</code>, <code>/api/health</code>, <code>/api/status</code></p>
</div></body></html>`;
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(html);
}

export function createDashboardServer(port: number): http.Server {
  const server = http.createServer(async (req, res) => {
    corsHeaders(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== "GET") {
      jsonResponse(res, { error: "Method not allowed" }, 405);
      return;
    }

    let pathname: string;
    try {
      pathname = new URL(req.url ?? "/", `http://localhost:${port}`).pathname;
    } catch {
      pathname = "/";
    }

    try {
      if (pathname === "/") {
        const lock = readLockfile();
        handleRoot(res, Object.keys(lock.servers).length);
      } else if (pathname === "/api/servers") {
        await handleGetServers(res);
      } else if (pathname.startsWith("/api/servers/")) {
        const name = decodeURIComponent(pathname.slice("/api/servers/".length));
        await handleGetServer(res, name);
      } else if (pathname === "/api/clients") {
        await handleGetClients(res);
      } else if (pathname === "/api/health") {
        await handleGetHealth(res);
      } else if (pathname === "/api/audit") {
        await handleGetAudit(res);
      } else if (pathname === "/api/status") {
        await handleGetStatus(res);
      } else {
        jsonResponse(res, { error: "Not found" }, 404);
      }
    } catch (err) {
      jsonResponse(res, { error: String(err) }, 500);
    }
  });

  server.listen(port);
  return server;
}
