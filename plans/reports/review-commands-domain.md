# Code Review: src/commands/ Domain

**Reviewer:** code-reviewer
**Date:** 2026-03-05
**Scope:** 44 command files + src/index.ts entry point
**Total LOC:** ~5,782 across command files

---

## Overall Assessment

The commands domain is well-structured with consistent use of citty's `defineCommand` pattern. Error handling is generally good with proper `process.exit(1)` on failures. The main concerns are: (1) widespread DRY violations with duplicated helper functions, (2) several hardcoded client lists that will drift from the `ClientType` union, and (3) incorrect exit codes in sync.ts that misreport success as failure.

---

## Critical Issues

### [C] sync.ts:135 -- Dry-run exits with code 1 (signals failure to CI)

```typescript
if (args["dry-run"]) {
  p.outro(pc.dim("Dry run -- no changes applied."));
  process.exit(1);  // BUG: should be 0
}
```

Dry-run is a success case. Exit code 1 breaks CI pipelines and scripted usage.

**Also at line 140-141:**
```typescript
if (addCount === 0 && removeCount === 0) {
  p.outro(pc.dim("No additions needed. Extra servers left untouched."));
  process.exit(1);  // BUG: should be 0
}
```

No changes needed is not an error.

### [C] pin.ts:96-98 -- Pin-then-read ordering bug

```typescript
pinServer(args.server, version);          // writes the new version
const prev = getPinnedVersion(args.server); // reads AFTER write -- always returns new version
if (prev && prev !== version) {            // this is ALWAYS false
```

The "Re-pinned" message is dead code. `getPinnedVersion` is called after `pinServer` writes the new value, so `prev` always equals `version`. The check should read the old value BEFORE calling `pinServer`.

### [C] install.ts:134-137 -- Lockfile restore only installs to first client

```typescript
await installServer(input, {
  client: entry.clients[0],  // only first client!
  yes: true,
});
```

If a server was installed to `["claude-desktop", "cursor"]`, restore only installs to `claude-desktop`. The full `entry.clients` array should be iterated or passed.

---

## High Priority

### [H] DRY: `loadVaultSecrets()` duplicated 4 times (run.ts, logs.ts, test-command.ts, watch.ts)

Identical function copy-pasted across 4 files. Should be extracted to a shared module (e.g., `src/core/vault-helpers.ts` or colocated utility).

**Files:** `run.ts:100`, `logs.ts:88`, `test-command.ts:115`, `watch.ts:120`

### [H] DRY: `CLIENT_DISPLAY` map duplicated 4 times (list.ts, remove.ts, sync.ts, diff.ts)

Same Record mapping client types to display names. Not derived from `ClientType` union -- must be manually updated when clients are added. Should be a single export in `src/utils/client-display.ts` or similar.

### [H] DRY: `VALID_CLIENTS` array duplicated in sync.ts and diff.ts

Hardcoded arrays that duplicate the `ClientType` union. Should derive from a single source of truth.

### [H] DRY: `loadClients()` duplicated in update.ts:10 and audit.ts:188

Same lazy-load pattern. Extract to shared utility.

### [H] DRY: `pad()` function duplicated in list.ts, sync.ts, search.ts, status.ts

Same string-padding helper in 4+ files. Extract to `src/utils/format-helpers.ts`.

### [H] DRY: `truncate()` function duplicated in list.ts and search.ts

Same truncation logic. Extract alongside `pad()`.

### [H] doctor.ts:120-137 -- runParallel results ordering not preserved

```typescript
const results: T[] = [];
const p = task().then((r) => {
  results.push(r);  // push order = completion order, not input order
```

Results array order depends on completion timing, not input order. For display purposes this may cause servers to appear in inconsistent order between runs.

### [H] install.ts:29 -- Client description in help text is stale-prone

```
description: "Target client (claude-desktop, cursor, vscode, windsurf, claude-code, roo-code, codex-cli, opencode, continue, zed)"
```

This string is duplicated in multiple commands (install, remove, link, validate) and will go stale when new clients are added. Should derive from a single constant.

---

## Medium Priority

### [M] Files exceeding 200-line limit

Per project convention, code files should stay under 200 lines:

| File | Lines | Over by |
|------|-------|---------|
| audit.ts | 318 | 118 |
| skill.ts | 301 | 101 |
| sync.ts | 225 | 25 |
| team.ts | 207 | 7 |

**audit.ts** is the worst offender. The `runAuditFix()` function (lines 198-318) should be extracted to a separate module or the existing `core/` layer.

**skill.ts** has 5 sub-commands and helper functions. The `RULE_SCAN_LOCATIONS` constant and `exportCommand` logic (lines 220-285) could live in `core/skill-service.ts`.

### [M] profiles.ts -- Uses positional arg for action instead of citty subCommands

```typescript
args: {
  action: { type: "positional", description: "Action: create, switch, list, or delete" },
  name: { type: "positional", description: "Profile name" },
}
```

Other commands (config, secrets, plugin, env, group, alias, template, notify, team, agent, skill) properly use `subCommands`. Profiles uses a manual switch statement, losing citty's built-in help text generation for sub-commands.

**Same issue in:** `registry.ts` -- uses positional action + switch instead of subCommands.

### [M] group.ts:157-166 -- Spawns `mcpman` as external process for group install

```typescript
const child = spawn("mcpman", ["install", server], { stdio: "inherit" });
```

This assumes `mcpman` is globally installed and in PATH. Won't work during development (`npx mcpman` or `tsx` invocations). Should call `installServer()` directly from the core module.

### [M] bench.ts:60-63 -- Manually parses envVars instead of using `parseEnvFlags`

```typescript
for (const ev of entry.envVars ?? []) {
  const idx = ev.indexOf("=");
  if (idx > 0) env[ev.slice(0, idx)] = ev.slice(idx + 1);
}
```

Other commands (run.ts, logs.ts, watch.ts) use the shared `parseEnvFlags()` helper. This duplicates the logic manually and could diverge.

### [M] create.ts:57-88 -- readline interface created 3 separate times

Each interactive prompt creates/destroys a readline interface separately. Should create one rl instance and reuse it, or use `@clack/prompts` like other commands do.

### [M] team.ts:111 -- Server names parsed via comma split instead of variadic positional

```typescript
const names = args.servers ? args.servers.split(",").map(s => s.trim()) : [];
```

Other commands (group) handle multiple servers as variadic positional args with `Array.isArray` checks. Comma-separated input is less ergonomic (`mcpman team share a,b` vs `mcpman team share a b`).

### [M] secrets.ts:57-58 -- `listSecrets` called twice for the same server

```typescript
const isNew =
  listSecrets(args.server).length === 0 ||
  !listSecrets(args.server)[0]?.keys.includes(parsed.key);
```

Two calls to `listSecrets` with the same argument. Cache the result in a local variable.

### [M] list.ts:22 -- Client filter description incomplete

```
description: "Filter by client (claude, cursor, vscode, windsurf)"
```

Only lists 4 of 10 clients. Missing: claude-code, roo-code, codex-cli, opencode, continue, zed.

### [M] remove.ts:39 -- Same incomplete client description

```
description: "Target client (claude, cursor, vscode, windsurf)"
```

---

## Low Priority

### [L] Inconsistent spinner libraries

Some commands use `@clack/prompts` spinner (`p.spinner()`), others use `nanospinner` (`createSpinner()`). Both work, but mixing them produces visually inconsistent output. Files using nanospinner: audit.ts, search.ts, info.ts, status.ts.

### [L] notify.ts -- `event` arg uses `required: true` with `type: "string"` instead of positional

The `add` sub-command defines `event` as a named string arg (`--event`), but the `test` sub-command defines it as a positional. Inconsistent interface within the same parent command.

### [L] replay.ts:53 -- `Number()` used instead of `Number.parseInt()` for index parsing

```typescript
const idx = Number(args.index);
```

Other commands (rollback.ts:61) use `Number.parseInt()`. Prefer parseInt for user-facing integer inputs to reject floats and hex strings.

### [L] status.ts:38 -- Color escape codes break column alignment

```typescript
`  ${pad(formatStatus(s), 7 + 10 /* color codes */)}  ${pad(formatResponseTime(s), 10 + 10)}  ${errStr}`
```

Magic number `+10` for color code width is fragile. Different color strings have different escape lengths.

### [L] Inconsistent `--json` flag availability

Commands with `--json`: list, audit, info, update, bench, diff, status, validate, why.
Commands without `--json` that could benefit: doctor, search, profiles, rollback.

---

## Positive Observations

1. **Consistent defineCommand pattern** -- all 44 commands follow citty conventions properly.
2. **Good error handling** -- most commands wrap operations in try/catch with user-friendly messages.
3. **Proper cancel handling** -- commands using `@clack/prompts` consistently check `p.isCancel()`.
4. **Helpful UX** -- "Did you mean?" suggestions in remove.ts, contextual next-step hints in create.ts, link.ts.
5. **Signal forwarding** -- run.ts, logs.ts, watch.ts properly forward SIGINT/SIGTERM to child processes.
6. **Clean subCommands** -- most multi-action commands (config, secrets, plugin, env, group, alias, template, notify, skill, agent, team) correctly use citty's subCommands.
7. **index.ts is clean** -- all 44 commands registered, proper SIGINT handler, correct naming for reserved words (test, export, import, env).

---

## Recommended Actions (Priority Order)

1. **Fix sync.ts exit codes** -- Change lines 135 and 141 from `process.exit(1)` to `process.exit(0)`. [Critical]
2. **Fix pin.ts read-before-write** -- Read `getPinnedVersion` before calling `pinServer`. [Critical]
3. **Fix install.ts lockfile restore** -- Iterate all `entry.clients`, not just `[0]`. [Critical]
4. **Extract shared helpers** -- Create `src/utils/vault-helpers.ts` for `loadVaultSecrets`, `src/utils/client-display.ts` for `CLIENT_DISPLAY` + `VALID_CLIENTS`, `src/utils/format-helpers.ts` for `pad`/`truncate`. [High]
5. **Refactor profiles.ts and registry.ts** to use citty `subCommands` instead of manual switch. [Medium]
6. **Split audit.ts** -- Move `runAuditFix()` into core layer to bring file under 200 lines. [Medium]
7. **Fix group.ts install** -- Call `installServer()` directly instead of spawning `mcpman` process. [Medium]

---

## Metrics

- **Files reviewed:** 45 (44 commands + index.ts)
- **Critical issues:** 3
- **High priority:** 8
- **Medium priority:** 11
- **Low priority:** 5
- **Files over 200 lines:** 4 (audit.ts, skill.ts, sync.ts, team.ts)
- **DRY violations:** `loadVaultSecrets` x4, `CLIENT_DISPLAY` x4, `VALID_CLIENTS` x2, `loadClients` x2, `pad` x5, `truncate` x2

---

## Unresolved Questions

1. Is there a reason profiles.ts and registry.ts use manual action dispatching instead of citty subCommands? If intentional (e.g., shared positional args), it should be documented.
2. The `--follow` flag in logs.ts defaults to true and has no effect (server always streams until killed). Is a non-follow mode planned?
3. Should `mcpman bench` also load vault secrets like `mcpman run` does? Currently it only parses lockfile envVars manually.
