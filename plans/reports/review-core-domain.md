# Code Review: src/core/ Domain

**Date:** 2026-03-05
**Reviewer:** code-reviewer
**Scope:** 52 files, ~7003 LOC in `/Users/tranhoangtu/Desktop/WORK/openS-Plan-R/src/core/`
**Focus:** Critical bugs, security, performance, code quality, type safety, file size

---

## Overall Assessment

The core domain is well-structured with clean separation of concerns. Each service file owns a single responsibility. Atomic writes are used consistently. Error handling follows a consistent pattern of silent fallback for non-critical operations. However, there are several security vulnerabilities, race conditions, and logic bugs that need attention.

---

## Critical Issues

### [C] notify-service.ts:102-108 -- Shell command injection via user-controlled hook target

```typescript
function fireShell(command: string, event: HookEvent, payload: NotifyPayload): void {
  execSync(command, { stdio: "inherit", env });
}
```

The `command` string is user-supplied (stored in `~/.mcpman/notify.json`) and passed directly to `execSync`. While the file is user-owned, any process that can write to `notify.json` can achieve arbitrary code execution. The `command` is not sanitized or validated.

**Fix:** Validate hook targets at registration time. Use `execFile` instead of `execSync` to avoid shell interpretation. At minimum, warn users about shell hooks.

### [C] history-service.ts:77-78 -- Command injection via `execSync` in `replayCommand`

```typescript
const fullCommand = ["mcpman", entry.command, ...entry.args].filter(Boolean).join(" ");
execSync(fullCommand, { stdio: "inherit" });
```

History entries are read from JSON on disk. If the history file is tampered with, arbitrary commands execute. Even without tampering, args containing shell metacharacters (`;`, `|`, `` ` ``) will be interpreted.

**Fix:** Use `execFile("mcpman", [entry.command, ...entry.args])` or `spawn` to avoid shell injection.

### [C] plugin-loader.ts:106 -- npm install with unsanitized package name

```typescript
execSync(`npm install --prefix "${pluginDir}" ${name}`, {
  stdio: "pipe",
  timeout: 60_000,
});
```

The `name` parameter is user-supplied and interpolated into a shell command. A name like `foo; rm -rf /` would be destructive. Same issue in `removePluginPackage` (line 125).

**Fix:** Use `execFile("npm", ["install", "--prefix", pluginDir, name])` to avoid shell interpretation.

### [C] dashboard-api.ts:51 -- Broken CORS header `http://localhost:*`

```typescript
"Access-Control-Allow-Origin": "http://localhost:*",
```

The `*` character in `http://localhost:*` is not valid CORS syntax. This header does nothing useful. Meanwhile, `corsHeaders()` on line 59 sets `*` (wildcard). The `jsonResponse` function overwrites CORS headers set by `corsHeaders()`, creating inconsistent behavior. On line 59, `corsHeaders(res)` is called for ALL requests, but `jsonResponse` sets its own conflicting `Access-Control-Allow-Origin`.

**Fix:** Remove the broken `Access-Control-Allow-Origin: http://localhost:*` from `jsonResponse()` and rely on the `corsHeaders()` function. Or restrict to `http://localhost` with port matching.

### [C] scaffold-service.ts:85 -- Template literal injection in generated TypeScript

```typescript
const indexTs = `...
const server = new Server(
  { name: "${name}", version: "0.1.0" },
  ...
```

The `name` parameter (from user input after sanitization) is interpolated directly into generated TypeScript code. While `sanitizeName()` limits to `[a-z0-9-]`, the Python template at line 148 uses `${name}` and `${description}` where `description` is **not sanitized** and could contain `"` or `\` characters, breaking the generated Python code or enabling code injection.

**Fix:** Escape `description` for both TypeScript and Python template contexts. For Python, escape with `JSON.stringify()` or replace quotes.

---

## High Priority

### [H] mcp-tester.ts:161-162 -- stdout buffer never cleared; grows unbounded and re-parses old lines

```typescript
child.stdout?.on("data", (chunk: Buffer) => {
  stdout += chunk.toString();
  processLines();  // re-splits entire accumulated stdout every time
});
```

The `processLines()` function splits the entire accumulated `stdout` on every chunk arrival and re-parses every line. This is O(n^2) and also means already-processed JSON lines are re-parsed. The same pattern exists in `bench-service.ts:68-81`, `status-checker.ts:91-113`, and `mcp-process-checks.ts:97-116`.

**Fix:** Track the last processed position and only parse new content, or clear processed lines from the buffer.

### [H] status-checker.ts:33-40 -- `ps aux` output matching is unreliable

```typescript
export function isProcessRunning(command: string): boolean {
  const out = execSync("ps aux", { encoding: "utf-8" });
  const bin = command.split("/").pop() ?? command;
  return out.includes(bin);
}
```

Matching by substring against `ps aux` output produces false positives (e.g., `node` matches any Node process, including mcpman itself). The `ps aux` output also includes the grep/command that generated it. Also, this function appears to be unused -- no callers found.

**Fix:** Remove if unused, or use PID-based tracking instead.

### [H] team-service.ts:196 -- Audit log write is NOT atomic

```typescript
fs.writeFileSync(filePath, JSON.stringify(log, null, 2) + "\n", "utf-8");
```

Unlike other files in the codebase that use `.tmp` + `rename` for atomic writes, the audit log writes directly. A crash during write corrupts the audit log.

**Fix:** Use the same `tmp + rename` pattern used elsewhere.

### [H] version-checker.ts:20-32 -- compareVersions returns 0 for non-numeric segments, hiding real updates

```typescript
if (Number.isNaN(aN) || Number.isNaN(bN)) return 0;
```

Pre-release versions like `1.2.3-beta.1` vs `1.2.3` will have their numeric parts parsed as NaN (because `Number("3-beta")` is NaN) and be treated as equal. This means updates from pre-release to release are never detected.

**Fix:** Strip pre-release suffix before parsing, or use a proper semver comparison library.

### [H] dashboard-api.ts:32-37 -- Declared const caches are immediately shadowed by mutable lets

```typescript
const healthCache: CacheEntry<unknown> | null = null;
const auditCache: CacheEntry<unknown> | null = null;
let _healthCache: CacheEntry<unknown> | null = healthCache;
let _auditCache: CacheEntry<unknown> | null = auditCache;
```

The `const` declarations on lines 32-33 are dead code. They are immediately assigned to `let` variables that are actually used. This is confusing and serves no purpose.

**Fix:** Remove lines 32-33, declare `let _healthCache` and `let _auditCache` directly with `null`.

### [H] server-resolver.ts:30-37 -- `detectSource` loads ALL plugins on every call

```typescript
const plugins = loadAllPlugins();
for (const plugin of plugins) {
  if (input.startsWith(plugin.prefix)) { ... }
}
```

`loadAllPlugins()` reads config from disk and `require()`s every plugin module. This is called from `detectSource()` which is called from `resolveServer()` and also from `installer.ts:142`. In `resolveServer()` line 70-71, `loadAllPlugins()` is called **again** for plugin resolution, meaning plugins are loaded twice per install.

**Fix:** Cache plugin list at module level or pass through as a parameter.

---

## Medium Priority

### [M] Files exceeding 200 lines (need modularization per project rules)

| File | Lines | Suggestion |
|------|-------|-----------|
| `installer.ts` | 261 | Split `installRemoteServer` to `remote-installer.ts` (which already exists but only has helpers) |
| `dashboard-api.ts` | 260 | Extract route handlers to `dashboard-routes.ts` |
| `security-scanner.ts` | 217 | Already at limit; consider extracting cache logic |
| `vault-service.ts` | 213 | Extract crypto functions to `vault-crypto.ts` |
| `mcp-tester.ts` | 213 | Extract stdio test logic to separate module |
| `completion-generator.ts` | 212 | Extract per-shell generators |
| `scaffold-service.ts` | 204 | Already borderline, acceptable |
| `link-service.ts` | 201 | Borderline, acceptable |
| `team-service.ts` | 200 | At limit, acceptable for now |

### [M] completion-generator.ts:11-57 -- Hardcoded command list will drift from actual CLI

`getCommandList()` returns a static array of command names. Adding a new CLI command without updating this list causes incomplete tab completion. Same issue with `getClientTypes()` at line 91-103.

**Fix:** Derive from a single source of truth (e.g., the Commander program object or a shared constant).

### [M] config-validator.ts:85-95 -- KnownClient type duplicates ClientType union

The `KnownClient` type is manually maintained to avoid circular deps (per memory notes). But it can still drift from the actual `ClientType` union. The `validateAll()` function at line 178 also hardcodes the client list.

### [M] env-manager.ts -- Plain-text env var store not warned about in docs

The file header says "NOT encrypted -- use `secrets` for sensitive values" but there is no runtime check or warning if a user stores something that looks like an API key (matching common patterns like `sk-`, `ghp_`, etc.).

### [M] Multiple files -- Inconsistent directory extraction pattern

- `notify-service.ts:38`: `target.substring(0, target.lastIndexOf("/"))`
- `history-service.ts:34`: `target.substring(0, target.lastIndexOf("/"))`
- `group-manager.ts:26`: `target.slice(0, target.lastIndexOf("/"))`
- `alias-manager.ts:25`: `target.substring(0, target.lastIndexOf("/"))`
- `pin-service.ts:27`: `target.slice(0, target.lastIndexOf("/"))`

All should use `path.dirname()` which handles edge cases (Windows paths, root paths, empty strings).

**Fix:** Replace with `path.dirname(target)` consistently.

### [M] diagnostics.ts:24 -- Shell injection in `which`/`where` command

```typescript
const { stdout } = await execAsync(`${cmd} ${runtimeCmd}`);
```

If `runtimeCmd` contains spaces or shell metacharacters, this breaks. A command like `node --version && rm -rf /` would be interpreted. The `command` parameter flows from lockfile data.

**Fix:** Use `execFile` instead of `exec` wrapping.

### [M] lockfile.ts:14 -- `runtime` field type is `"node" | "python" | "docker"` but team-service sets it to `"node"` unconditionally

In `team-service.ts:131`, `syncTeamToLocal` hardcodes `runtime: "node"` regardless of the team server's actual runtime.

### [M] registry.ts:23-26 -- `computeIntegrity` hashes the URL, not the package content

```typescript
export function computeIntegrity(resolvedUrl: string): string {
  const hash = createHash("sha512").update(resolvedUrl).digest("base64");
  return `sha512-${hash}`;
}
```

This is labeled "MVP approximation" via comment. The integrity hash of a URL changes nothing about package authenticity -- different packages at the same URL would have the same "integrity" hash. This gives false assurance.

### [M] server-inventory.ts:25 -- `readConfig()` return type mismatch

```typescript
config = await client.readConfig();
// ...
for (const [name, entry] of Object.entries(config.servers)) {
```

The variable is typed `Record<string, ServerEntry> | undefined` but `readConfig()` returns `ClientConfig` which has `{ servers: Record<string, ServerEntry> }`. The code accesses `.servers` correctly on line 30, but the local variable type annotation on line 23 is wrong.

---

## Low Priority

### [L] DRY violations -- MCP_INIT_REQUEST duplicated in 3 files

The JSON-RPC initialize request body is duplicated in:
- `mcp-process-checks.ts:48-57`
- `status-checker.ts:20-29`
- `mcp-tester.ts:201-209` (slightly different version string)
- `bench-service.ts:85-94`

**Fix:** Extract to a shared constant.

### [L] vault-service.ts:34-36 -- Password clearing on process exit is best-effort

```typescript
process.on("exit", () => { _cachedPassword = null; });
```

Setting to `null` does not securely erase the string from memory. The GC may not immediately collect it. Node.js does not support secure memory wiping.

### [L] Dead imports -- `execSync` in history-service.ts line 7 is used but risky (see Critical above)

### [L] config-diff.ts:89 -- Redundant `as ClientType` cast

```typescript
actions.push({ server, client: client as ClientType, action: extraAction });
```

The `client` variable comes from `Map<ClientType, ClientConfig>` iteration, so it is already `ClientType`. Same at line 119.

### [L] security-scanner.ts:81 -- Double encodeURIComponent for scoped npm packages

```typescript
fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`, { signal })
```

Scoped packages like `@scope/name` will be encoded to `%40scope%2Fname`, which is correct for npm registry URLs. No issue here, but the downloads endpoint on line 82 may behave differently.

---

## Positive Observations

1. **Atomic writes** used consistently across lockfile, vault, config, and update-cache writes
2. **Timeout handling** on all network requests via `AbortSignal.timeout()`
3. **Graceful degradation** -- all network-dependent functions return sensible defaults on failure
4. **Clean type definitions** -- interfaces are well-documented and narrowly typed
5. **Separation of concerns** -- each file owns a single domain concept
6. **Concurrency limiting** in `scanAllServers` and `checkAllVersions` prevents overwhelming APIs
7. **Ring buffer pattern** in rollback-service with content deduplication is elegant
8. **Vault service** uses proper PBKDF2 with 100K iterations and per-entry salts

---

## Metrics

- **Files reviewed:** 52
- **Total LOC:** 7,003
- **Files > 200 lines:** 9 (17%)
- **Critical issues:** 5
- **High issues:** 7
- **Medium issues:** 8
- **Low issues:** 5
- **Type Coverage:** High (explicit types on all exports, minimal `any` usage)
- **Test Coverage:** Not assessed (out of scope)

---

## Recommended Actions (Prioritized)

1. **[IMMEDIATE]** Fix shell injection in `notify-service.ts`, `history-service.ts`, `plugin-loader.ts`, and `diagnostics.ts` -- switch from `execSync`/`exec` string interpolation to `execFile`/`execFileSync` with argument arrays
2. **[IMMEDIATE]** Fix CORS header in `dashboard-api.ts` -- `http://localhost:*` is invalid
3. **[IMMEDIATE]** Escape `description` in scaffold templates to prevent generated code injection
4. **[HIGH]** Fix stdout buffer accumulation in mcp-tester/bench-service/status-checker -- track parse position
5. **[HIGH]** Fix `compareVersions` to handle pre-release segments
6. **[HIGH]** Replace `path.lastIndexOf("/")` with `path.dirname()` across 5 files
7. **[MEDIUM]** Extract `MCP_INIT_REQUEST` to shared constant
8. **[MEDIUM]** Cache plugin list in `server-resolver.ts` to avoid double-loading
9. **[MEDIUM]** Modularize files exceeding 200 lines (installer, dashboard-api, security-scanner, vault-service, mcp-tester)
10. **[LOW]** Clean up dead code: `const healthCache`/`auditCache` in dashboard-api, unused `isProcessRunning`

---

## Unresolved Questions

1. Is `computeIntegrity` hashing URLs intentional as an MVP compromise, or should it hash actual package content?
2. Should the `dashboard-api.ts` CORS policy be restricted to localhost only, or is wildcard `*` acceptable for a local dev server?
3. The `team-service.ts` hardcodes `runtime: "node"` during sync -- is there a plan to detect runtime from team config?
