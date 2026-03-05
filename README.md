# mcpman

[![npm version](https://img.shields.io/npm/v/mcpman)](https://www.npmjs.com/package/mcpman)
[![npm downloads](https://img.shields.io/npm/dm/mcpman)](https://www.npmjs.com/package/mcpman)
[![GitHub stars](https://img.shields.io/github/stars/tranhoangtu-it/openS-Plan-R)](https://github.com/tranhoangtu-it/openS-Plan-R)
[![license](https://img.shields.io/npm/l/mcpman)](https://github.com/tranhoangtu-it/openS-Plan-R/blob/main/LICENSE)
![node](https://img.shields.io/node/v/mcpman)

**The package manager for MCP servers.**

Install, manage, and inspect Model Context Protocol servers across 10 AI clients — Claude Desktop, Claude Code, Cursor, VS Code, Windsurf, Roo Code, Codex CLI, OpenCode, Continue, and Zed — from a single CLI.

<p align="center">
  <img src="./demo.gif" alt="mcpman demo" width="700">
</p>

---

## Quick Start

```sh
# Install an MCP server globally (no install required)
npx mcpman install @modelcontextprotocol/server-filesystem

# Or install mcpman globally
npm install -g mcpman
mcpman install @modelcontextprotocol/server-filesystem
```

---

## Features

### Universal Client Support

Manages servers for **10 AI clients** from one tool:

| Client | Config Format |
|--------|--------------|
| Claude Desktop | JSON (`claude_desktop_config.json`) |
| Claude Code CLI | JSON (`~/.claude.json`) |
| Cursor | JSON (`~/.cursor/mcp.json`) |
| VS Code | JSON (settings.json `mcp` section) |
| Windsurf | JSON (`~/.codeium/windsurf/mcp_config.json`) |
| Roo Code | JSON (`mcp_settings.json`) |
| Codex CLI | TOML (`~/.codex/config.toml`) |
| OpenCode | TOML (`~/.config/opencode/config.toml`) |
| Continue | JSON (`~/.continue/config.json`) |
| Zed | JSON (`~/.config/zed/settings.json`) |

### Core

- **Registry-aware** — resolves packages from npm, Smithery, GitHub URLs, or the mcpman community registry
- **Lockfile** — tracks installed servers in `mcpman.lock` for reproducible setups
- **Health checks** — verifies runtimes, env vars, and server connectivity with `doctor`
- **Encrypted secrets** — store API keys in an AES-256 encrypted vault; auto-loads during install
- **Config sync** — keep server configs consistent across all your AI clients; `--remove` cleans extras
- **Security audit** — scan servers for vulnerabilities with trust scoring; `--fix` auto-updates vulnerable packages
- **Auto-update** — get notified when server updates are available
- **No extra daemon** — pure CLI, works anywhere Node >= 20 runs

### v2.0 Platform Features

- **MCP Server Mode** — run mcpman itself as an MCP server with `mcpman serve`. AI agents can install, audit, and manage servers via 8 programmatic tools. Write protection via `--allow-write`
- **Remote Transport** — connect to remote MCP servers over HTTP and SSE. No local process needed
- **Registry & Publishing** — publish your own MCP servers with `mcpman publish`. Community registry powered by Cloudflare D1/R2
- **Embedded Dashboard** — launch a local HTTP dashboard with `mcpman dashboard`. REST API with server status, audit results, and health checks
- **Team Collaboration** — share server configs with `mcpman team`. RBAC roles (admin/maintainer/viewer), shared vault, and audit logging
- **Skills & Agent Sync** — universal `mcpman-skill.json` spec with format adapters for all 10 clients. Sync agent configs, tools, models, and rules across editors

### Developer Tools

- **Server scaffolding** — `mcpman create` with Node.js and Python templates
- **Local dev linking** — `mcpman link` registers a local directory (like `npm link`)
- **File watching** — `mcpman watch` auto-restarts on source changes
- **Plugin system** — extend mcpman with npm-based plugins for custom registries
- **Shell completions** — tab-complete commands and server names in bash, zsh, and fish
- **Export/Import** — portable JSON bundles for full config migration
- **Profiles** — save/restore named server configurations
- **Auto-rollback** — snapshots before every lockfile write, restore with `mcpman rollback`

---

## Commands

### Core

#### `install <server>`

Install an MCP server and register it with your AI clients.

```sh
mcpman install @modelcontextprotocol/server-filesystem
mcpman install my-smithery-server
mcpman install https://github.com/owner/repo
mcpman install mcpman:my-registry-server    # from mcpman registry
```

**Options:**
- `--client <type>` — target a specific client (`claude-desktop`, `cursor`, `vscode`, `windsurf`, `claude-code`, `roo-code`, `codex-cli`, `opencode`, `continue`, `zed`)
- `--json` — output machine-readable JSON

#### `list`

List all installed MCP servers.

```sh
mcpman list
mcpman list --client cursor
mcpman list --json
```

#### `remove <server>`

Uninstall a server and deregister it from all clients.

```sh
mcpman remove @modelcontextprotocol/server-filesystem
```

#### `update [server]`

Check for and apply updates to installed MCP servers.

```sh
mcpman update            # update all servers
mcpman update my-server  # update specific server
mcpman update --check    # check only, don't apply
```

#### `upgrade`

Upgrade mcpman itself to the latest version.

```sh
mcpman upgrade
mcpman upgrade --check
```

### Health & Diagnostics

#### `doctor [server]`

Run health diagnostics on all installed servers or a specific one.

```sh
mcpman doctor
mcpman doctor my-server
```

Checks: runtime availability, required env vars, process spawn, and MCP handshake.

#### `test [server]`

Validate MCP server connectivity via JSON-RPC `initialize` + `tools/list`.

```sh
mcpman test my-server
mcpman test --all
```

#### `validate [--client <name>]`

Validate lockfile schema and client config JSON for correctness.

```sh
mcpman validate
mcpman validate --client cursor
```

#### `status [--server <name>]`

Show live process status of all installed MCP servers.

```sh
mcpman status
mcpman status --server my-server --json
```

#### `bench <server>`

Benchmark MCP server latency with JSON-RPC initialize calls.

```sh
mcpman bench my-server --runs 10
mcpman bench my-server --timeout 5000
```

### Config & Sync

#### `init`

Scaffold an `mcpman.lock` file in the current directory.

```sh
mcpman init
```

#### `config <set|get|list|reset>`

Manage persistent CLI configuration.

```sh
mcpman config set defaultClient cursor
mcpman config get defaultClient
mcpman config list
```

#### `sync`

Sync MCP server configs across all detected AI clients.

```sh
mcpman sync
mcpman sync --dry-run
mcpman sync --source cursor --remove
```

#### `diff <client-a> <client-b>`

Show visual diff of MCP server configs between two clients.

```sh
mcpman diff claude-desktop cursor
```

#### `secrets`

Manage encrypted secrets (AES-256-CBC vault).

```sh
mcpman secrets set my-server OPENAI_API_KEY=sk-...
mcpman secrets list my-server
mcpman secrets remove my-server OPENAI_API_KEY
```

#### `env <set|get|list|del|clear>`

Manage per-server environment variables (non-sensitive defaults).

```sh
mcpman env set my-server API_URL=https://api.example.com
mcpman env list my-server
```

### Discovery & Registry

#### `search <query>`

Search for MCP servers on npm, Smithery, or mcpman registry.

```sh
mcpman search filesystem
mcpman search brave --registry smithery
mcpman search tools --all --limit 10
```

#### `info <server>`

Show detailed information about an MCP server package.

```sh
mcpman info @modelcontextprotocol/server-filesystem
```

#### `why <server>`

Show why a server is installed — source, clients, profiles, env vars.

```sh
mcpman why my-server
```

#### `publish`

Publish an MCP server to the mcpman community registry.

```sh
mcpman publish
mcpman publish --registry https://registry.mcpman.dev
```

#### `registry <list|add|remove|set-default>`

Manage custom registry URLs.

```sh
mcpman registry list
mcpman registry add corp https://mcp.corp.com/api
mcpman registry remove corp
```

### Server Authoring

#### `create [name]`

Scaffold a new MCP server project.

```sh
mcpman create my-server
mcpman create my-server --runtime python
```

#### `link [dir]`

Register a local MCP server directory with AI clients.

```sh
mcpman link .
mcpman link ./path/to/server --client cursor
```

#### `watch <server>`

Watch source files and auto-restart on changes.

```sh
mcpman watch my-server
mcpman watch my-server --ext ts,js --delay 500
```

### Organization

#### `profiles <create|switch|list|delete>`

Manage named server configuration profiles.

```sh
mcpman profiles create dev
mcpman profiles switch dev
mcpman profiles list
```

#### `group <add|rm|list|delete|install|run>`

Organize servers into named groups for batch operations.

```sh
mcpman group add work server-a server-b
mcpman group install work
mcpman group run work
```

#### `pin <server> [version]`

Pin a server to a specific version.

```sh
mcpman pin my-server 1.2.3
mcpman pin --unpin my-server
```

#### `rollback [index]`

Restore a previous lockfile state from automatic snapshots.

```sh
mcpman rollback --list
mcpman rollback 0
```

#### `template <save|apply|list|delete>`

Save and share install templates.

```sh
mcpman template save myteam
mcpman template apply myteam
```

### Platform (v2.0)

#### `serve`

Run mcpman as an MCP server over stdio transport. AI agents can call 8 tools: `mcpman_install`, `mcpman_remove`, `mcpman_list`, `mcpman_search`, `mcpman_audit`, `mcpman_doctor`, `mcpman_info`, `mcpman_status`.

```sh
mcpman serve                 # read-only mode (default)
mcpman serve --allow-write   # enable destructive operations (remove)
```

#### `dashboard`

Launch an embedded HTTP dashboard with REST API endpoints.

```sh
mcpman dashboard
mcpman dashboard --port 8080
```

Endpoints: `/api/servers`, `/api/clients`, `/api/health`, `/api/audit`, `/api/status`.

#### `team <init|add|remove|list|sync|share|audit>`

Team collaboration with RBAC and shared vault.

```sh
mcpman team init my-team               # initialize team config
mcpman team add alice --role maintainer # add team member
mcpman team sync                       # sync team servers to local
mcpman team share                      # share local servers to team
mcpman team audit                      # view audit log
```

Roles: `admin` (full access), `maintainer` (add/remove servers), `viewer` (read-only).

#### `skill <install|list|remove|sync|export>`

Manage MCP server skills with universal spec.

```sh
mcpman skill install ./my-skill
mcpman skill sync --client claude-code
mcpman skill list
```

#### `agent <sync|list|export>`

Sync agent configurations across AI clients.

```sh
mcpman agent sync
mcpman agent list
mcpman agent export --client roo-code
```

### Operations

#### `run <server>`

Launch an MCP server with vault secrets auto-injected.

```sh
mcpman run my-server
```

#### `logs <server>`

Stream stdout/stderr from an MCP server process.

```sh
mcpman logs my-server
```

#### `notify <add|remove|list|test>`

Configure webhook and shell hooks for lifecycle events.

```sh
mcpman notify add --event install --webhook https://hooks.example.com/mcp
mcpman notify test install
```

#### `replay [index]`

Re-run previous CLI commands from history.

```sh
mcpman replay --list
mcpman replay 0
```

#### `alias <add|remove|list>`

Create command shorthands.

```sh
mcpman alias add fs "install @modelcontextprotocol/server-filesystem"
```

#### `export / import`

Portable config migration.

```sh
mcpman export backup.json
mcpman import backup.json --dry-run
```

#### `plugin <add|remove|list>`

Manage npm-based plugins for custom registries.

```sh
mcpman plugin add mcpman-plugin-ollama
```

#### `completions <bash|zsh|fish|install>`

Generate shell completion scripts.

```sh
source <(mcpman completions bash)
mcpman completions install
```

---

## Comparison

| Feature | mcpman | Smithery CLI | mcpm.sh |
|---|---|---|---|
| Multi-client support | **All 10 clients** | Claude only | Limited |
| Lockfile | `mcpman.lock` | None | None |
| Health checks | Runtime + env + process | None | None |
| Encrypted secrets | AES-256 vault | None | None |
| Config sync | Cross-client + `--remove` | None | None |
| Security audit | Trust scoring + auto-fix | None | None |
| MCP server mode | 8 tools via stdio | None | None |
| Remote transport | HTTP + SSE | None | None |
| Dashboard | REST API + UI | None | None |
| Team collaboration | RBAC + audit log | None | None |
| Skills & agent sync | Universal spec + adapters | None | None |
| Registry & publishing | npm + Smithery + GitHub + mcpman | Smithery only | npm only |
| Plugin system | npm-based custom registries | None | None |
| Server scaffolding | Node + Python templates | None | None |
| Local dev linking | `link` (like npm link) | None | None |
| File watching | `watch` (auto-restart) | None | None |
| Shell completions | bash + zsh + fish | None | None |
| Export/Import | Full config portability | None | None |
| Profiles | Named config switching | None | None |
| Auto-rollback | Snapshot + restore | None | None |
| CI/CD | GitHub Actions | None | None |

---

## Contributing

1. Fork the repo and create a feature branch
2. `npm install` to install dependencies
3. `npm test` to run the test suite (1,123 tests)
4. Submit a pull request with a clear description

Please follow the existing code style (TypeScript strict, ES modules).

---

## License

MIT
