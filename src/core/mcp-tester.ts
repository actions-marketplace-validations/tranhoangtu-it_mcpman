/**
 * mcp-tester.ts
 * Validates MCP servers by spawning them (stdio) or sending HTTP requests (remote)
 * and sending JSON-RPC requests. Used by `mcpman test` command.
 */

import { spawn } from "node:child_process";

export interface McpTestResult {
  serverName: string;
  passed: boolean;
  initializeOk: boolean;
  toolsListOk: boolean;
  tools: string[];
  responseTimeMs: number;
  error?: string;
}

const TIMEOUT_MS = 10_000;

/**
 * Test a remote MCP server via HTTP POST JSON-RPC.
 */
export async function testRemoteMcpServer(
  serverName: string,
  url: string,
  headers: Record<string, string> = {},
): Promise<McpTestResult> {
  const start = Date.now();

  async function rpc(
    id: number,
    method: string,
    params: unknown = {},
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return (await res.json()) as Record<string, unknown>;
  }

  try {
    // 1. initialize
    const initRes = await rpc(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mcpman-test", version: "1.0.0" },
    });
    const initOk = initRes.jsonrpc === "2.0" && !!initRes.result;
    if (!initOk) {
      return {
        serverName,
        passed: false,
        initializeOk: false,
        toolsListOk: false,
        tools: [],
        responseTimeMs: Date.now() - start,
        error: "initialize failed",
      };
    }

    // 2. tools/list
    const toolsRes = await rpc(2, "tools/list");
    const result = toolsRes.result as Record<string, unknown> | undefined;
    const tools = Array.isArray(result?.tools)
      ? (result.tools as Array<{ name?: string }>).map((t) => t.name ?? "").filter(Boolean)
      : [];

    return {
      serverName,
      passed: true,
      initializeOk: true,
      toolsListOk: true,
      tools,
      responseTimeMs: Date.now() - start,
    };
  } catch (err) {
    return {
      serverName,
      passed: false,
      initializeOk: false,
      toolsListOk: false,
      tools: [],
      responseTimeMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Test a stdio MCP server by spawning and sending JSON-RPC requests.
 * Returns detailed result with pass/fail and discovered tools.
 */
export async function testMcpServer(
  serverName: string,
  command: string,
  args: string[],
  env: Record<string, string>,
): Promise<McpTestResult> {
  const start = Date.now();

  return new Promise((resolve) => {
    let settled = false;
    let stdoutBuf = "";
    let stdoutCursor = 0; // index into stdoutBuf where unprocessed data starts
    let initOk = false;
    let toolsOk = false;
    let tools: string[] = [];

    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const done = (result: Partial<McpTestResult>) => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      resolve({
        serverName,
        passed: result.passed ?? false,
        initializeOk: result.initializeOk ?? initOk,
        toolsListOk: result.toolsListOk ?? toolsOk,
        tools: result.tools ?? tools,
        responseTimeMs: Date.now() - start,
        error: result.error,
      });
    };

    const timer = setTimeout(() => {
      done({ error: "Timeout: no response within 10s" });
    }, TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(timer);
      done({ error: `Spawn error: ${err.message}` });
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      if (!settled) {
        done({ error: `Process exited with code ${code} before completing` });
      }
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      processNewLines();
    });

    function processNewLines() {
      // Only scan newly appended data — avoids O(n^2) re-splitting
      let newlineIdx: number;
      while ((newlineIdx = stdoutBuf.indexOf("\n", stdoutCursor)) !== -1) {
        const line = stdoutBuf.slice(stdoutCursor, newlineIdx).trim();
        stdoutCursor = newlineIdx + 1;
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as Record<string, unknown>;
          if (msg.jsonrpc !== "2.0") continue;

          // Response to initialize (id=1)
          if (msg.id === 1 && !initOk) {
            initOk = true;
            // Send tools/list request
            const toolsReq = JSON.stringify({
              jsonrpc: "2.0",
              id: 2,
              method: "tools/list",
              params: {},
            });
            child.stdin?.write(`${toolsReq}\n`);
          }

          // Response to tools/list (id=2)
          if (msg.id === 2 && initOk) {
            toolsOk = true;
            const result = msg.result as Record<string, unknown> | undefined;
            if (result && Array.isArray(result.tools)) {
              tools = (result.tools as Array<{ name?: string }>)
                .map((t) => t.name ?? "")
                .filter(Boolean);
            }
            clearTimeout(timer);
            done({ passed: true, initializeOk: true, toolsListOk: true, tools });
          }
        } catch {
          /* not JSON yet */
        }
      }
    }

    // Send initialize request
    const initReq = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "mcpman-test", version: "0.6.0" },
      },
    });
    child.stdin?.write(`${initReq}\n`);
  });
}
