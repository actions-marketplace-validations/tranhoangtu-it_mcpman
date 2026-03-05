# Code Review: src/clients/ Domain

**Date:** 2026-03-05
**Reviewer:** code-reviewer
**Scope:** All 13 files in `src/clients/` (531 LOC total) + cross-cutting concerns in `src/core/config-validator.ts`, `src/utils/paths.ts`, and `src/commands/{list,remove,sync,diff}.ts`

---

## Overall Assessment

The client handler layer is well-architected. The `BaseClientHandler` abstract class provides a clean Template Method pattern, and all 10 handlers follow it consistently. Atomic writes prevent corruption. Type safety is strong with exhaustive `ClientType` switches.

However, there are several bugs ranging from data-silent-loss to incorrect validation for non-standard clients, plus significant DRY violations in display-name maps across 4 command files.

---

## Critical Issues

### [C] config-validator.ts:137 -- VS Code/Zed/OpenCode validation uses wrong key lookup

```typescript
const servers = (obj.mcpServers ?? (obj as Record<string, unknown>)["mcp.servers"]) as ...
```

**Problem:** VS Code stores servers at `obj.mcp.servers` (nested), not `obj["mcp.servers"]` (flat key with dot). This lookup will always be `undefined` for VS Code configs, so the validator silently reports "valid" even when servers have malformed entries. Same issue: Zed uses `context_servers`, OpenCode uses `mcp` -- neither is checked.

**Impact:** `mcpman validate` gives false positives for 3 out of 10 clients.

**Fix:** The validator should use each client's handler `toClientConfig()` to extract servers, or maintain a per-client key map.

### [C] opencode.ts:40-42 -- `command` field can be `undefined`, producing `command: undefined`

```typescript
const cmdArray = (entry.command ?? []) as string[];
if (cmdArray.length === 0) continue;  // skips entries without command
```

This correctly skips entries with empty/missing `command` on READ. However on WRITE:

```typescript
mcp[name] = {
  type: "local",
  command: [entry.command, ...(entry.args ?? [])],  // line 41
  enabled: true,
};
```

If `entry.command` is `undefined` (e.g., a remote/SSE server entry), the output becomes `command: [undefined, ...]`. This corrupts the OpenCode config file.

**Fix:** Guard `fromClientConfig` to skip entries without `command`, or filter undefined from the array.

### [C] continue-client.ts:44-47 -- Duplicate `name` values silently overwrite

```typescript
for (const entry of mcpArray) {
  const { name, ...rest } = entry;
  servers[name] = rest;  // last-writer-wins
}
```

If a user's `config.yaml` has two entries with the same `name`, the second silently overwrites the first. On next write, the first entry is permanently lost.

**Impact:** Data loss -- user loses MCP server config entries.

**Fix:** Detect duplicates and either warn or merge. At minimum, log a warning.

---

## High Priority

### [H] opencode.ts:42 -- `enabled: true` always injected, overwrites user's `enabled: false`

```typescript
mcp[name] = {
  type: "local",
  command: [...],
  enabled: true,  // hardcoded
};
```

If a user has manually set `enabled: false` for a server in their OpenCode config, any `mcpman` write operation (add/remove another server) resets ALL servers to `enabled: true`.

**Fix:** Preserve existing `enabled` state by reading it from the raw data before overwriting. Or omit the field entirely and let OpenCode use its default.

### [H] base-client-handler.ts:92-94 -- TOCTOU race in writeConfig

```typescript
async writeConfig(config: ClientConfig): Promise<void> {
  const raw = await this.readRaw();   // read
  // ...gap where another process could write...
  await this.writeRaw(this.fromClientConfig(raw, config));  // write
}
```

`addServer` and `removeServer` both call `readConfig()` then `writeConfig()`, which internally does another `readRaw()`. Between the two reads and the final write, another process (or another mcpman invocation) could modify the file. The second process's changes would be lost.

**Impact:** Medium in practice (CLI tool, not a server), but still a correctness issue for concurrent operations.

**Fix:** Consider file locking (e.g., `proper-lockfile`) or at minimum document the limitation.

### [H] DRY violation -- CLIENT_DISPLAY duplicated in 4 files

`CLIENT_DISPLAY` maps are independently hardcoded in:
- `/Users/tranhoangtu/Desktop/WORK/openS-Plan-R/src/commands/list.ts:106`
- `/Users/tranhoangtu/Desktop/WORK/openS-Plan-R/src/commands/remove.ts:8`
- `/Users/tranhoangtu/Desktop/WORK/openS-Plan-R/src/commands/sync.ts:34`
- `/Users/tranhoangtu/Desktop/WORK/openS-Plan-R/src/commands/diff.ts:26`

Adding a new client requires updating all 4 locations manually. The `displayName` property already exists on every handler instance.

**Fix:** Export a single `getClientDisplayName(type: ClientType): string` from `client-detector.ts` that instantiates or caches the handler and returns `handler.displayName`. Or export a static map derived from the handlers.

### [H] installer.ts:54-56 -- Hardcoded client list string

```
"Supported: Claude Desktop, Cursor, VS Code, Windsurf, Claude Code, Roo Code, Codex CLI, OpenCode, Continue, Zed"
```

This string must be manually updated whenever clients are added. It duplicates information already available in `getAllClientTypes()` and `displayName`.

**Fix:** Generate this string dynamically: `getAllClientTypes().map(t => getClient(t).displayName).join(", ")`.

---

## Medium Priority

### [M] base-client-handler.ts:44-46 -- `isInstalled()` false-negative on fresh installs

```typescript
async isInstalled(): Promise<boolean> {
  const dir = path.dirname(this.getConfigPath());
  return pathExists(dir);
}
```

For clients where the config directory is deeply nested and only created after first launch (e.g., Roo Code: `Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/`), this returns `false` even if the client application is installed but hasn't been configured yet.

**Impact:** `mcpman install --client roo-code` would silently skip Roo Code on machines where it's installed but not yet configured.

### [M] opencode.ts -- Does not preserve unknown fields within server entries

`fromClientConfig` rebuilds each server entry from scratch with only `type`, `command`, `enabled`, and optionally `environment`. Any other fields the user had in their OpenCode config (e.g., custom metadata, `timeout`, etc.) are silently dropped.

**Fix:** Merge with existing raw entry data instead of replacing.

### [M] codex-cli.ts:34 -- Unsafe TOML.stringify cast

```typescript
await atomicWrite(configPath, TOML.stringify(data as TOML.JsonMap));
```

The `as TOML.JsonMap` cast bypasses type checking. If `data` contains values TOML cannot represent (e.g., `undefined`, functions, symbols), `TOML.stringify` may throw or produce invalid output.

### [M] config-validator.ts:85-95 -- `KnownClient` type duplicates `ClientType`

The `KnownClient` type is a manual copy of `ClientType`. If someone adds a client to `ClientType` but forgets `KnownClient`, `resolveConfigPath` will accept it but the validator will reject it as "Unknown client".

**Note:** Comment says this is intentional to avoid circular deps, which is fair, but a shared type or build-time check would be safer.

### [M] zed.ts -- No special handling for Zed's nested settings structure

Zed's `settings.json` may contain deeply nested LSP, theme, and other settings. The handler uses the default JSON `readRaw/writeRaw`, which is correct, but `fromClientConfig` does a shallow spread:

```typescript
return { ...raw, context_servers: config.servers };
```

This is fine for top-level keys but should be documented as safe only because `context_servers` is top-level in Zed's schema.

### [M] paths.ts:136-137 -- OpenCode path hardcodes `~/.config` regardless of platform

```typescript
case "opencode":
  return path.join(home, ".config", "opencode", "opencode.json");
```

On macOS, this bypasses `getAppDataDir()` (which returns `~/Library/Application Support`). The memory notes say this is intentional ("uses `~/.config` on all platforms"), but it should be documented with a comment explaining why, as it breaks the pattern of other clients.

---

## Low Priority

### [L] client-detector.ts:14-27 -- `getAllClientTypes()` list could drift from switch

The array in `getAllClientTypes()` is manually maintained separately from the `switch` in `getClient()`. TypeScript exhaustiveness checking covers `getClient()` but not the array.

**Fix:** Derive the array from the switch or use a const assertion tuple that is validated against `ClientType`.

### [L] types.ts:15-23 -- ServerEntry allows both stdio and remote fields simultaneously

```typescript
export interface ServerEntry {
  command?: string;     // stdio
  args?: string[];      // stdio
  url?: string;         // remote
  type?: TransportType;
  // ...
}
```

Nothing prevents an entry from having both `command` and `url`. A discriminated union would be more type-safe.

### [L] base-client-handler.ts:75 -- Unsafe cast in toClientConfig

```typescript
const mcpServers = (raw.mcpServers ?? {}) as Record<string, ServerEntry>;
```

No runtime validation that values are actually `ServerEntry` shaped. Malformed config files will be silently accepted.

### [L] continue-client.ts:42 -- Unsafe cast of array elements

```typescript
const mcpArray = (raw.mcpServers ?? []) as Array<{ name: string } & ServerEntry>;
```

No runtime check that array entries actually have a `name` field. Missing `name` would produce `servers[undefined]`.

---

## Positive Observations

1. **Clean Template Method pattern** -- `BaseClientHandler` is well-designed. Only 3 override points needed for simple clients, with optional format hooks for non-standard ones.
2. **Atomic writes** -- `.tmp + rename` pattern prevents config corruption on crashes.
3. **Exhaustive switch** -- `resolveConfigPath` and `getClient` both use TypeScript's exhaustive checking via `ClientType`, making it a compile error to add a client without handling it.
4. **Error classes** -- `ConfigParseError`, `ConfigWriteError`, `ConfigNotFoundError` provide structured error handling with config path context.
5. **File sizes** -- All files well under 200-line limit (largest is `base-client-handler.ts` at 108 lines).
6. **Separation of concerns** -- Format conversion (TOML, YAML) cleanly isolated in handler subclasses.

---

## Recommended Actions (Priority Order)

1. **Fix config-validator** to handle VS Code (`mcp.servers`), Zed (`context_servers`), and OpenCode (`mcp`) key formats correctly. Consider using each handler's `toClientConfig()` instead of reimplementing key lookup.
2. **Fix OpenCode `fromClientConfig`** to guard against `undefined` command and preserve `enabled` state from existing config.
3. **Add duplicate-name detection** in Continue handler's `toClientConfig`.
4. **Extract CLIENT_DISPLAY** into a shared utility derived from handler `displayName` properties. Remove the 4 hardcoded copies.
5. **Generate installer warning string** dynamically from `getAllClientTypes()`.
6. **Add comments** to OpenCode path explaining cross-platform `~/.config` convention.

---

## Metrics

| Metric | Value |
|--------|-------|
| Files reviewed | 13 source + 4 command files |
| Total LOC (clients/) | 531 |
| Critical issues | 3 |
| High issues | 4 |
| Medium issues | 6 |
| Low issues | 4 |
| File size violations | 0 |
| Type coverage | High (few unsafe casts, noted above) |

---

## Unresolved Questions

1. Is the OpenCode `~/.config` path intentional on macOS? The README table says TOML format for OpenCode but the code uses JSON -- which is authoritative?
2. Should `isInstalled()` check for the application binary instead of the config directory to handle fresh installs?
3. Is concurrent mcpman invocation a real-world scenario that warrants file locking?
