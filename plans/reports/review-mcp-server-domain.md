# Code Review: src/mcp-server/ Domain

**Date:** 2026-03-05
**Reviewer:** code-reviewer
**Scope:** 7 source files, 2 test files (~540 LOC source, ~960 LOC tests)

## Overall Assessment

Well-structured MCP server implementation. Clean separation: barrel exports, helper utilities, domain-grouped handlers. All handlers consistently use `textResult`/`errorResult` helpers. Write protection via `--allow-write` flag is correctly wired. However, several medium-severity issues found around type safety, protocol compliance, edge case handling, and a critical write-protection gap.

---

## Findings

### [C1] CRITICAL — `tools-registry.ts:13` — `writeEnabled` is module-level mutable state shared across all connections

The `writeEnabled` boolean is a module-level `let`. Once `setWriteEnabled(true)` is called, it persists for the entire process lifetime. If the server is ever restarted within the same process (e.g., test scenarios, hot-reload), the flag cannot be reset to `false` without explicitly calling `setWriteEnabled(false)`. This is a design smell but not exploitable in the current single-serve-command architecture.

**Impact:** Low in production (single invocation per process), but risky if architecture changes.

**Fix:** Move `writeEnabled` into server context or accept it as a parameter to `handleRemove`.

```ts
// Option A: pass as param
export async function handleRemove(args: Record<string, unknown>, opts: { writeEnabled: boolean }): Promise<CallToolResult> {
```

---

### [H1] HIGH — `tools-diagnostics.ts:88` — Hardcoded `env: {}` discards lockfile env vars in doctor check

```ts
const serverEntry: ServerEntry = {
  command: entry.command,
  args: entry.args,
  env: {},  // <-- BUG: ignores entry.envVars from lockfile
  type: entry.transport as ServerEntry["type"],
  url: entry.url,
  headers: {},
};
```

The lockfile stores `envVars: string[]` (variable names), but `ServerEntry.env` expects `Record<string, string>` (key-value pairs). The handler hardcodes `env: {}`, meaning the doctor health check will spawn the MCP server process **without** the required environment variables. Servers that depend on `API_KEY` or similar env vars will fail the health check even when properly configured.

**Impact:** Doctor reports false "unhealthy" status for servers requiring environment variables.

**Fix:** Resolve `envVars` names from `process.env` and pass them:

```ts
const env: Record<string, string> = {};
for (const key of entry.envVars ?? []) {
  if (process.env[key]) env[key] = process.env[key]!;
}
```

---

### [H2] HIGH — `tools-diagnostics.ts:89` — Unsafe cast `entry.transport as ServerEntry["type"]`

```ts
type: entry.transport as ServerEntry["type"],
```

`LockEntry.transport` is `"stdio" | "http" | "sse" | undefined`. `ServerEntry["type"]` is `TransportType | undefined` which is the same union. The cast is technically safe today, but `as` suppresses any future divergence between the two types. If either type changes, the compiler won't catch the mismatch.

**Impact:** Silent type mismatch if types diverge in future.

**Fix:** Use a satisfies or intermediate variable with explicit type annotation instead of `as`.

---

### [H3] HIGH — `tools-registry.ts:91` — `limit` is clamped locally but also passed to external APIs unclamped

```ts
const limit = Math.max(1, Math.min(100, typeof args.limit === "number" ? args.limit : 10));
```

The `limit` is correctly clamped for the local slice (`smitheryResults.slice(0, limit)`, `npmResults.slice(0, limit)`), but the **same clamped value** is also passed to `searchNpm(query, limit)` and `searchSmithery(query, limit)`. This means both registries return up to `limit` items each, and the output can show up to `2 * limit` results total (limit from npm + limit from Smithery). The tool description says "Maximum number of results (default: 10, max: 100)" which implies a total cap, not per-registry.

**Impact:** Agent receives up to 200 results when requesting 100, causing token waste and confusion.

**Fix:** Pass `limit` to APIs but clarify in the schema description that it's per-registry, OR halve the limit per registry:

```ts
const perRegistry = Math.ceil(limit / 2);
const [npmResults, smitheryResults] = await Promise.all([
  searchNpm(query, perRegistry),
  searchSmithery(query, perRegistry),
]);
```

---

### [M1] MEDIUM — `tools-diagnostics.ts:45` — Non-pluralized vulnerability count

```ts
const vulnSummary = vulnCount === 0 ? "no vulnerabilities" : `${vulnCount} vulnerability/vulnerabilities`;
```

The string literally says "1 vulnerability/vulnerabilities" instead of proper English pluralization. This is user-facing output consumed by AI agents.

**Impact:** Cosmetic but unprofessional; AI agents may parse this poorly.

**Fix:**

```ts
const vulnSummary = vulnCount === 0
  ? "no vulnerabilities"
  : `${vulnCount} ${vulnCount === 1 ? "vulnerability" : "vulnerabilities"}`;
```

---

### [M2] MEDIUM — `tools-query.ts:21` — Unsafe `as never` cast in client filter

```ts
const filtered = filterClient
  ? entries.filter(([, entry]) => entry.clients?.includes(filterClient as never))
  : entries;
```

`entry.clients` is `ClientType[]` and `filterClient` is `string`. The `as never` cast silences the type error instead of validating that `filterClient` is a valid `ClientType`. An agent passing an invalid client string (e.g., `"foo"`) will silently get an empty result with no error.

**Impact:** No input validation on client filter. Silent failure on invalid input.

**Fix:** Validate `filterClient` against known `ClientType` values and return an error if invalid. At minimum, remove the `as never` and use a proper type guard or cast to the union type with a runtime check.

---

### [M3] MEDIUM — `types.ts` — Schemas lack `additionalProperties: false`

None of the JSON schemas set `additionalProperties: false`. Per MCP protocol best practices, tool input schemas should reject unexpected properties. Without this, agents can pass arbitrary extra fields that silently do nothing, masking integration errors.

**Impact:** Silent acceptance of malformed input. Harder to debug agent integration issues.

**Fix:** Add `additionalProperties: false` to each schema:

```ts
export const installSchema = {
  type: "object",
  additionalProperties: false,
  properties: { ... },
  required: ["name"],
};
```

---

### [M4] MEDIUM — `tools-registry.ts` — `handleInstall` description says "does not write to lockfile" but `removeSchema` comment says "requires --allow-write"

The install tool description says: *"Returns info but does not write to lockfile."* This is correct — `handleInstall` is read-only. However, the `installSchema` accepts a `client` parameter that is **never used** in `handleInstall`. The handler ignores `args.client` entirely.

```ts
// types.ts line 12
client: { type: "string", description: "Target client type (e.g. claude-code, cursor)" },

// tools-registry.ts — handleInstall never reads args.client
```

**Impact:** Agents will pass a `client` argument expecting it to be used, but it's silently ignored. Misleading API contract.

**Fix:** Either remove `client` from `installSchema` or document in the description that it's currently ignored.

---

### [M5] MEDIUM — `server.ts:109` — Unknown tool error uses `as const` on type but not via `errorResult` helper

```ts
return {
  content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
  isError: true,
};
```

All other error paths use the `errorResult()` helper, but the unknown-tool case constructs the error manually. This is a DRY violation and adds an unnecessary `as const`.

**Fix:**

```ts
import { errorResult } from "./tool-helpers.js";
// ...
default:
  return errorResult(`Unknown tool: ${name}`);
```

---

### [M6] MEDIUM — No test for `handleRemove` when `writeEnabled` is `false`

The test file calls `setWriteEnabled(true)` in `beforeEach` for all remove tests but never tests the default `writeEnabled = false` path. This is the security-critical write-protection gate and has zero test coverage.

**Impact:** Regression risk on the write-protection mechanism.

**Fix:** Add test:

```ts
it("returns error when writeEnabled is false", async () => {
  setWriteEnabled(false);
  const result = await handleRemove({ name: "test-mcp" });
  expect(getText(result)).toContain("Write operations are disabled");
  expect(result.isError).toBe(true);
});
```

---

### [L1] LOW — `tools-query.ts:8` — Unused import in production path

```ts
import { resolveFromNpm } from "../core/registry.js";
```

This import is used only in the `handleInfo` fallback path (when server is not in lockfile). It's not "unused" per se, but it means `handleInfo` makes a network call to npm as a fallback, which could be slow. Consider documenting this behavior or making it opt-in.

**Impact:** None functionally. Minor concern about unexpected network calls.

---

### [L2] LOW — `tool-helpers.ts` — No `isError: false` explicit on `textResult`

```ts
export function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}
```

The MCP protocol defaults `isError` to `false` when omitted, so this is technically correct. However, being explicit aids readability and grep-ability.

---

### [L3] LOW — `types.ts:33` — `required: []` instead of omitting `required`

JSON Schema allows omitting `required` entirely when no properties are required. Using `required: []` is valid but redundant.

---

## Edge Cases Found by Scouting

1. **`handleDoctor` env passthrough gap (H1):** The doctor health check spawns servers without their configured environment variables, causing false-negative health reports.

2. **`handleInstall` ignores `client` param (M4):** The schema advertises a `client` parameter but the handler never reads it, creating a misleading API contract for AI agents.

3. **`handleRemove` write-protection untested (M6):** The security gate (`writeEnabled = false`) has no test coverage. A refactor could accidentally remove the check without test failure.

4. **`handleSearch` double-limit (H3):** Agents requesting `limit: 50` get up to 100 results (50 per registry), violating the implicit contract.

5. **`handleList` client filter accepts any string (M2):** Invalid `ClientType` values silently produce empty results instead of an error.

---

## Positive Observations

- **Consistent error handling:** Every handler wraps its body in try/catch and returns `errorResult()`. No unhandled rejections possible.
- **Clean barrel exports:** `tools.ts` provides a single import point. Server.ts doesn't need to know which file a handler lives in.
- **Write protection by default:** Destructive operations require explicit `--allow-write` flag. Good security posture.
- **MCP protocol compliance:** All tools return proper `CallToolResult` with `content` array. Unknown tools get `isError: true`. Schemas have correct `type: "object"` and `required` arrays.
- **Comprehensive test suite:** 60+ tests covering all 8 handlers, dispatch routing, schema validation, and error paths. Good use of mocked dependencies.
- **Deterministic output:** Audit results are sorted by server name for reproducibility.

---

## Recommended Actions (Priority Order)

1. **Add write-protection test** [M6] — Immediate, low effort, high safety value
2. **Fix env passthrough in handleDoctor** [H1] — Causes false health check failures
3. **Fix or clarify search limit behavior** [H3] — Misleading API contract
4. **Remove unused `client` from installSchema or document it** [M4] — Misleading API contract
5. **Fix vulnerability pluralization** [M1] — Quick cosmetic fix
6. **Replace `as never` with proper validation** [M2] — Type safety improvement
7. **Use `errorResult` for unknown tool case** [M5] — DRY consistency
8. **Consider `additionalProperties: false`** [M3] — Protocol hardening

---

## Metrics

| Metric | Value |
|---|---|
| Source LOC | ~540 |
| Test LOC | ~960 |
| Test count | 60+ |
| Error paths covered | All handlers have try/catch |
| Write protection | Present but untested for `false` case |
| Unused code | `client` param in `installSchema` (dead) |
| Type safety issues | 2 (`as never`, `as ServerEntry["type"]`) |

---

## Unresolved Questions

1. Should `handleInstall` eventually support the `client` parameter, or should it be removed from the schema?
2. Is the `2 * limit` search result behavior intentional (per-registry limit) or a bug (should be total limit)?
3. Should `handleInfo` fallback to npm be opt-in via a flag, given it makes a network call?
