# Code Review: src/utils/ + src/adapters/

**Date:** 2026-03-05
**Reviewer:** code-reviewer
**Scope:** 15 files, ~550 LOC across `src/utils/` (3 files) and `src/adapters/` (11 files)

---

## Overall Assessment

Well-structured codebase with clean separation of concerns. Adapter pattern is consistent and well-typed. Several cross-platform path bugs, one DRY violation, and documentation drift are the main issues.

---

## Critical Issues

### [C] paths.ts:135-137 — OpenCode hardcodes `~/.config` on all platforms

```ts
case "opencode":
  return path.join(home, ".config", "opencode", "opencode.json");
```

**Problem:** Uses `~/.config` directly instead of `getAppDataDir()`. On macOS this should resolve to `~/Library/Application Support/opencode/opencode.json`, on Windows to `%APPDATA%/opencode/opencode.json`. Currently returns `~/.config/opencode/opencode.json` on all platforms.

**Impact:** OpenCode config will not be found on macOS/Windows if the application stores its config in the platform-standard location.

**Note:** This *may* be intentional if OpenCode truly uses `~/.config` on all platforms (XDG convention). Verify against OpenCode docs. If intentional, add a comment explaining why `getAppDataDir()` is deliberately not used. README line 47 says `~/.config/opencode/config.toml` (TOML, not JSON) -- also contradicts code.

### [C] paths.ts:143-145 — Zed hardcodes `~/.config` on all platforms

```ts
case "zed":
  return path.join(home, ".config", "zed", "settings.json");
```

**Problem:** Same issue as OpenCode. On macOS, Zed actually stores settings in `~/Library/Application Support/Zed/settings.json`, not `~/.config/zed/settings.json`.

**Impact:** Zed config path is wrong on macOS. `mcpman` will fail to find/modify Zed settings for all macOS users.

**Fix:**
```ts
case "zed":
  return path.join(appData, "Zed", "settings.json");
```

---

## High Priority

### [H] README.md:41 — Claude Code config path wrong in docs

README says `~/.claude.json` but code uses `~/.claude/.mcp.json`. Documentation misleads users.

### [H] README.md:47 — OpenCode format/path mismatch in docs

README says TOML at `~/.config/opencode/config.toml`. Code uses JSON at `~/.config/opencode/opencode.json`. Both filename and format disagree.

### [H] README.md:48 — Continue format/path mismatch in docs

README says JSON at `~/.continue/config.json`. Code uses YAML at `~/.continue/config.yaml`. Both filename and format disagree.

### [H] README.md:44 — Windsurf path wrong in docs

README says `~/.codeium/windsurf/mcp_config.json`. Code resolves to `{appData}/Windsurf/User/globalStorage/windsurf.mcpConfigJson/mcp.json`. Completely different paths.

### [H] README.md:42 — Cursor path wrong in docs

README says `~/.cursor/mcp.json`. Code resolves to `{appData}/Cursor/User/globalStorage/cursor.mcp/mcp.json`. Different paths.

### [H] opencode.ts:42 — `enabled: true` always injected on write

```ts
mcp[name] = {
  type: "local",
  command: [...],
  enabled: true,  // <-- always overwritten
  ...
};
```

**Problem:** If a user manually set `enabled: false` for a server, any write-back through mcpman will silently re-enable it. The `toClientConfig` read path does not preserve `enabled`, so round-tripping always resets it.

**Fix:** Preserve the `enabled` field from the original raw data during `fromClientConfig`, or at minimum don't inject `enabled: true` when the entry already exists.

### [H] continue-client.ts:42-47 — Duplicate `name` values silently overwrite

```ts
for (const entry of mcpArray) {
  const { name, ...rest } = entry;
  servers[name] = rest;  // last one wins if duplicates
}
```

**Problem:** If the YAML array contains two entries with the same `name`, the second silently overwrites the first. No warning emitted.

**Fix:** Add a warning via `logger.warn()` when a duplicate name is detected:
```ts
if (servers[name]) {
  warn(`Continue config: duplicate server name "${name}" — last entry wins`);
}
```

---

## Medium Priority

### [M] adapters/formats/*.ts — `FormatOutput` interface duplicated 8 times

Every format file defines its own identical `FormatOutput` interface:
```ts
export interface FormatOutput {
  filename: string;
  content: string;
}
```

Files: `claude-code-agent-format.ts`, `claude-code-format.ts`, `codex-agent-format.ts`, `codex-format.ts`, `cursor-format.ts`, `roo-code-agent-format.ts`, `roo-code-format.ts`, `windsurf-format.ts`

**Fix:** Extract to a shared location (e.g., `src/adapters/adapter-types.ts`) and import everywhere. DRY violation.

### [M] codex-format.ts vs claude-code-format.ts — Near-identical implementations

`codex-format.ts` and `claude-code-format.ts` are functionally identical except:
- Header line: `"# Project Rules"` vs `"# Agent Rules"`
- Output filename: `"CLAUDE.md"` vs `"AGENTS.md"`

Similarly `roo-code-format.ts` and `windsurf-format.ts` are identical except for directory names.

**Suggestion:** Consider a factory function that parameterizes these differences. Not blocking but reduces maintenance burden for 4 nearly identical files.

### [M] logger.ts:4-6 — Flags evaluated once at module load

```ts
const noColor = process.env.NO_COLOR !== undefined || process.argv.includes("--no-color");
const isVerbose = process.argv.includes("--verbose");
const isJson = process.argv.includes("--json");
```

**Problem:** These are evaluated when the module first loads. If the logger is imported before argv is fully populated (e.g., in tests or programmatic use), the flags are wrong and cannot be changed. Not a bug in CLI usage, but makes testing harder.

**Suggestion:** Either use getters or accept flags as parameters for testability.

### [M] skill-adapter.ts:86-88 — Fragile InstalledSkill envelope detection

```ts
if (typeof parsed === "object" && parsed !== null && "spec" in (parsed as Record<string, unknown>)) {
  parsed = (parsed as Record<string, unknown>).spec;
}
```

**Problem:** Any JSON with a top-level `spec` key will be unwrapped. If someone creates a skill where `spec` is an unrelated field, this silently extracts the wrong data. Consider checking for `installedAt` or `path` fields as additional discriminators.

### [M] paths.ts:106-112 — VS Code path duplicated for darwin/win32

```ts
if (process.platform === "darwin") {
  return path.join(appData, "Code", "User", "settings.json");
}
if (process.platform === "win32") {
  return path.join(appData, "Code", "User", "settings.json");
}
return path.join(home, ".config", "Code", "User", "settings.json");
```

Both darwin and win32 return the same expression. Could be simplified to:
```ts
if (process.platform === "darwin" || process.platform === "win32") {
  return path.join(appData, "Code", "User", "settings.json");
}
```

---

## Low Priority

### [L] constants.ts — APP_VERSION hardcoded as "2.0.0"

Version is hardcoded rather than derived from `package.json`. Any version bump requires editing this file. Consider importing from `package.json` at build time.

### [L] claude-code-agent-format.ts:18-21 — Model map may go stale

```ts
const MODEL_MAP = {
  fast: "claude-haiku-4-5",
  balanced: "claude-sonnet-4-5",
  powerful: "claude-opus-4-5",
};
```

Model IDs will need updating when new Claude models release. No runtime fallback if `model` value is not in map.

### [L] roo-code-agent-format.ts:37 — Silent default to "read" group

```ts
if (groups.size === 0) groups.add("read");
```

When no tools map to known groups, defaults to read-only. Could surprise users who specified custom tool names expecting write access.

### [L] agent-format-registry.ts:21-25 — AGENT_SUPPORTED_CLIENTS Set is redundant with switch

The `AGENT_SUPPORTED_CLIENTS` Set duplicates knowledge already in the `getAgentFormatAdapter` switch. If a new client gets agent support, both must be updated. Same pattern in `format-registry.ts:24-30`.

---

## Positive Observations

1. **Exhaustive switch statements** in registries and `resolveConfigPath` -- TypeScript narrowing ensures new `ClientType` values produce compile errors if not handled.
2. **Clean adapter pattern** -- `FormatAdapter` / `AgentFormatAdapter` interfaces are minimal and easy to implement.
3. **Atomic writes** used throughout client handlers via `atomicWrite()`.
4. **Good error handling** in `skill-adapter.ts` -- separate try/catch for file read vs JSON parse with descriptive messages.
5. **NO_COLOR / --json mode** support in logger follows CLI best practices.
6. **All path functions are pure** -- no side effects, easy to test.

---

## Summary Table

| Severity | Count | Category |
|----------|-------|----------|
| Critical | 2 | Cross-platform path bugs (OpenCode, Zed) |
| High | 6 | Docs drift (4), data loss on round-trip (OpenCode enabled), silent overwrites (Continue) |
| Medium | 5 | DRY violations, testability, fragile detection |
| Low | 4 | Hardcoded version, stale model map, silent defaults, redundant sets |

---

## Recommended Actions (Priority Order)

1. **Verify Zed config path on macOS** -- likely needs `path.join(appData, "Zed", "settings.json")`
2. **Verify OpenCode config path** -- confirm whether `~/.config` is used cross-platform or if it follows OS conventions
3. **Fix README table** -- at minimum 5 path/format entries are wrong (Claude Code, Cursor, Windsurf, OpenCode, Continue)
4. **Preserve `enabled` field in OpenCode adapter** round-trip
5. **Add duplicate-name warning in Continue adapter**
6. **Extract shared `FormatOutput` interface** to reduce 8x duplication
7. **Simplify VS Code darwin/win32 path branch**
