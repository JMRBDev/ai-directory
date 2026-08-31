# AI Directory

AI Directory is a Git-backed registry for reusable AI development resources — skills, agents, rules, MCP servers, resource packs, plugins, and tools — with a local website and a command-line tool that installs them across coding harnesses (Claude Code, OpenCode, Codex, Pi).

The repository is a Turborepo monorepo. It contains the local website, the Hono server boundary, the Bun CLI, and shared TypeScript packages. The resource registry itself is a separate Git repository that you configure and is not stored in this application repository.

## Stack

- Turborepo and pnpm workspaces
- TypeScript
- Hono for the local HTTP application boundary
- Vite, React, TanStack Router, and TanStack Query for the website
- Source-owned shadcn-style UI components with Tailwind CSS
- Bun for the CLI runtime and release binaries
- Citty for CLI commands and flags
- `@clack/prompts` for interactive CLI flows

## Workspace

```text
apps/
  api/              Local Hono entrypoint
  cli/              Bun CLI entrypoint
  web/              Static React website

packages/
  config/          Shared user/project configuration
  contracts/        Shared API and registry contracts
  installers/       Harness adapter boundary
  registry/         Git-backed registry boundary
  server-core/      Reusable Hono application
```

## License

MIT. See [LICENSE](LICENSE).

## Start development

```sh
pnpm install
pnpm dev
```

The root `dev` command starts the long-running Hono API and Vite website. The CLI is interactive or command-driven and is not part of that process; run it directly with `apps/cli/dist/aid ...` after `pnpm build`.

Run the development CLI without building its compiled binary:

```sh
pnpm --filter @ai-directory/cli dev -- list
pnpm --filter @ai-directory/cli dev -- --help
```

Use the guided CLI when you do not want to remember arguments:

```sh
apps/cli/dist/aid
apps/cli/dist/aid install
apps/cli/dist/aid update
apps/cli/dist/aid uninstall
```

The guided flows search resources, select the installation scope, and allow one or more harnesses. Existing flags remain available. Commands do not prompt when stdin or stdout is not a terminal; provide the required positional arguments and options for scripts or CI.

Create a resource locally before submitting it:

```sh
apps/cli/dist/aid create
apps/cli/dist/aid create my-skill \
  --type skills \
  --owner octocat \
  --description "Review TypeScript changes." \
  --output ./my-skill
```

The command creates the required entry file (`SKILL.md`, `AGENT.md`, `RULE.md`, `MCP.md`, `TEMPLATE.md`, `.claude-plugin/plugin.json`, or `TOOL.md`). Add supporting files as needed, then use the printed `aid submit` command. Templates can contain existing resources with `--resources owner/type/name@version,...`.

Tools are first-class command resources. Their `TOOL.md` file declares `name`, `description`, a safe command name, an optional `executables` list for script files, and an optional structured `runtime` block. The runtime block names the command, an optional minimum version, and allowlisted package-manager recipes for Homebrew, pipx, npm, or Cargo. The CLI checks the command before installation, asks for permission in an interactive terminal, runs only generated package-manager commands, and verifies the installed version. Pass `--install-dependencies` for non-interactive installs. Hooks are adapter files inside the tool bundle, not a separate top-level resource type.

Validate a resource before submitting it:

```sh
apps/cli/dist/aid validate ./my-skill \
  --id octocat/skills/my-resource \
  --version 1.0.0
```

Validation is local and does not require a registry checkout. It checks the resource ID, version, required entry file, non-empty content, and template manifest syntax.

## Resource discovery

After setup, normal commands read the production branch of the configured Git registry:

```sh
apps/cli/dist/aid list
```

For development or offline work, pass an explicit local index:

```sh
apps/cli/dist/aid list --index /path/to/registry/index.json
```

The CLI uses a temporary sparse checkout for Git reads. It does not keep a registry clone. `--index` and `AI_DIRECTORY_REGISTRY_INDEX` are explicit local overrides. Use `--type`, `--include-retired`, or `--json` to filter the result.

Set the registry once for the current user:

```sh
apps/cli/dist/aid config set repository \
  git@github.com:you/ai-directory-registry.git
```

After this, `list`, `show`, `install`, and `submit` use the configured Git repository by default. Use `--scope project` to store an override in `.ai-directory/config.json`, or use `AI_DIRECTORY_REGISTRY_REPOSITORY` for an environment-level override. Inspect the effective value with `aid config get repository`.

List the available configuration options:

```sh
apps/cli/dist/aid config list
```

`--index` and `AI_DIRECTORY_REGISTRY_INDEX` are runtime local-index overrides. They are not stored configuration values.

Set up the CLI interactively:

```sh
apps/cli/dist/aid setup
```

The setup flow checks Git access, reads the production `main` branch, and saves the repository URL. Use `--scope project` to save it in `.ai-directory/config.json` for the current project. Use `--non-interactive` and `--skip-check` for scripted or offline setup:

```sh
apps/cli/dist/aid setup \
  --repository git@github.com:you/ai-directory-registry.git \
  --scope user \
  --non-interactive
```

Check the configuration and registry connection at any time:

```sh
apps/cli/dist/aid doctor
apps/cli/dist/aid doctor --json
```

The CLI uses the Git credentials already configured on the machine. It does not store Git credentials in AI Directory configuration.

## Manage agent harnesses

Inspect, install, update, and remove the supported coding harnesses themselves:

```sh
apps/cli/dist/aid harness list
apps/cli/dist/aid harness install codex
apps/cli/dist/aid harness update codex
apps/cli/dist/aid harness uninstall codex
```

Installs prefer the official installer channels published by each harness (`claude.ai/install.sh`, `opencode.ai/install`, `pi.dev/install.sh`) and fall back to an allowlisted package-manager command (npm global packages). Updates use the harness's own official update command (`claude update`, `opencode upgrade`, `pi update --self`). Every action first detects how the harness was installed — npm, Homebrew, or a native installer — and only acts through the matching channel: installs verify the version afterwards, and uninstalls refuse with guidance when the binary was not installed through a supported package manager. Harness configuration directories such as `~/.claude` or `~/.codex` are never touched. Interactive terminals ask for confirmation first; scripted runs pass `--yes`. The website Settings sheet shows the same detection with Install, Update, and Uninstall actions behind a confirmation dialog.

Pi is supported as a first-class harness. Resources install into `~/.pi/agent/` (`PI_CODING_AGENT_DIR` overrides it): skills into `skills/`, rules into a managed block in `AGENTS.md`, plugins and tools into `extensions/`. Pi has no sub-agents, so `agents` resources report an unsupported error for this harness.

Pi has no built-in MCP support, but the community `pi-mcp-adapter` extension adds it. When that adapter is installed, AI Directory writes MCP servers to `~/.pi/agent/mcp.json` (global) and `.mcp.json` (project) using the standard MCP shape, which the adapter loads. Manage the adapter from the website Settings (Pi MCP adapter section) or the CLI:

```sh
apps/cli/dist/aid harness pi-mcp-adapter status
apps/cli/dist/aid harness pi-mcp-adapter install
apps/cli/dist/aid harness pi-mcp-adapter uninstall
```

MCP resources still report unsupported when the adapter is not installed, and the Settings sheet shows its availability.

## Run the local catalog

The website is local-first. It reads the same registry index as the CLI and starts a loopback Hono control API for local settings. It does not require a hosted service:

```sh
pnpm build
apps/cli/dist/aid web --open
```

Use the Settings control in the catalog to configure the registry repository from the browser. The sheet writes through the local API, so the CLI and website share the same user/project configuration. Use `--index`, `--host`, or `--port` to change the local setup. The CLI serves the built Vite `dist` folder and the Hono API from one process.

Use `Publish` in the catalog to submit a resource. The local API keeps uploaded files in a temporary directory and removes them after validation or submission. Website publishing requires the configured source to be a Git repository and uses the existing Git and GitHub CLI credentials. Use `Refresh registry` on the catalog after a pull request is merged to fetch the latest production branch.

For a release, ship the compiled `aid` binary. The CLI build embeds the built website into the binary itself (`--asset`), so `aid web` serves the SPA from the single executable with no extra files. During development the CLI still prefers a `apps/web/dist` on disk, or `AI_DIRECTORY_WEB_DIST` when the assets use another location.

The release version lives in the root `package.json` and is the single source of truth: the CLI bakes it into its `--version` output and the embedded server reports it on `/health`, and the website build bakes the same value in at compile time. When a hosted website connects to a local server of a different version, Settings shows both versions and warns when the server is older.

## Host the website and pair it with your local CLI

The website is a static SPA. The same build you run locally can be hosted on a static host (for example Vercel) so others can browse the public catalog without running anything.

```sh
# Deploy apps/web/dist as a static site on Vercel (or any static host).
# The SPA uses relative asset paths, so it works from a subpath too.
```

A hosted site is read-only until it connects to a running local CLI. To control a machine from the hosted site:

1. On that machine, start the local server: `aid web --open` (or `--host 0.0.0.0 --port 4321` to accept connections from your browser).
2. `aid web` prints a **pairing token** and the local URL (`http://127.0.0.1:4321`).
3. In the hosted website, open **Settings → Local connection**, enter the URL and token, then **Connect**.

The browser calls your local API directly (client-side). The pairing token is a **one-time bootstrap credential**: the website exchanges it once for a **session token** and uses that session for subsequent requests, so a printed token cannot be reused if it leaks after you connect. Same-origin requests (when you open `http://127.0.0.1:4321` directly) do not need a token. From the local page you can list active remote sessions and revoke one at any time. Pass `--no-token` to `aid web` to allow cross-origin access without pairing — use it only on a trusted LAN or localhost.

```sh
apps/cli/dist/aid web --host 0.0.0.0 --port 4321
# Pairing token: 1f2e... ; enter http://<machine-ip>:4321 and the token in Settings.
```

Note: browsers allow a page served over HTTPS to call `http://127.0.0.1` and `http://localhost` (treated as trustworthy origins). A hosted page calling `http://<LAN-IP>` may be blocked as mixed content; prefer the loopback address and a tunnel if the CLI runs elsewhere.

## Inspect the registry

Inspect a version from the configured registry:

```sh
apps/cli/dist/aid show octocat/skills/typescript-api-review
```

Use `--version` to inspect a specific version or `--json` for machine-readable output.

Pass a repository for a one-command override:

```sh
apps/cli/dist/aid show octocat/skills/typescript-api-review \
  --repository git@github.com:you/ai-directory-registry.git
```

The command uses a temporary sparse checkout for `index.json` and the requested resource. It removes that checkout after reading. An explicit `--index` takes precedence over the repository option.

Validate the configured remote registry before using it:

```sh
apps/cli/dist/aid check
```

To validate an explicit local index instead, pass `--index`:

```sh
apps/cli/dist/aid check --index /path/to/registry/index.json
```

## Submit a resource for review

Prepare a resource directory with its required entry file (`SKILL.md`, `AGENT.md`, `RULE.md`, `MCP.md`, `TEMPLATE.md`, `.claude-plugin/plugin.json`, or `TOOL.md`) and publish it to the linked registry:

```sh
apps/cli/dist/aid submit ./my-resource \
  --id octocat/skills/my-resource \
  --version 1.0.0 \
  --description "Short resource description"
```

The command uses a temporary partial checkout. It does not keep a full registry copy on the machine. The command creates a branch, copies the package, updates `index.json`, commits and pushes the branch, and opens a pull request through the authenticated GitHub CLI. The production branch remains unchanged until reviewers merge the pull request.

In an interactive terminal, `submit` validates the local inputs and asks for confirmation before it creates the branch and pull request.

The same remote checkout mode is available during installation:

```sh
apps/cli/dist/aid install octocat/skills/typescript-api-review \
  --scope project --harness claude-code
```

Select the target harness when needed:

```sh
apps/cli/dist/aid install octocat/skills/typescript-api-review \
  --harness opencode --scope project

apps/cli/dist/aid install octocat/skills/typescript-api-review \
  --harness codex --scope project
```

Install a tool and its declared runtime dependency in a script or CI job:

```sh
apps/cli/dist/aid install octocat/tools/semgrep \
  --harness codex \
  --install-dependencies
```

The installers use explicit harness adapters. The current prototype uses documented native filesystem mechanisms: project OpenCode rules are stored in `.opencode/rules/` and registered in `opencode.json` or `opencode.jsonc` through its `instructions` field; project Codex rules are stored in `.ai-directory/rules/` and added as managed blocks to `AGENTS.override.md` or `AGENTS.md`; Codex agents are converted from the registry's `AGENT.md` to `.codex/agents/<name>.toml`; Claude Code and Codex tool bundles preserve their adapter files; OpenCode tool bundles install `.opencode/plugin.ts` or `.opencode/plugin.js` in `plugins/` and `.opencode/tools/*` in `tools/`. Existing user content remains unchanged. The adapters honor `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `OPENCODE_CONFIG`, and `OPENCODE_CONFIG_DIR` when those harnesses provide them.

Project installations are recorded in `.ai-directory/installed.json`. Global installations are recorded in the user's AI Directory data directory. List tracked installations and update one resource from the latest production version:

```sh
apps/cli/dist/aid installed
apps/cli/dist/aid update octocat/skills/typescript-api-review \
  --scope project
```

Pass `--version` to update to a specific version instead of the latest; the command reports when the installation is already at the requested version.

Template installations are expanded into their component resources. Use `installed` to see those components and update them individually.

## Update the CLI

The compiled `aid` binary can update itself from a tagged GitHub release of this repository:

```sh
apps/cli/dist/aid self-update          # check and apply the latest release
apps/cli/dist/aid self-update --dry-run # check only; do not download or swap
apps/cli/dist/aid self-update --yes    # apply without prompting (for scripts)
```

`self-update` queries `gh release view` for the newest `vX.Y.Z` tag, downloads the asset matching the current platform and architecture (`aid-darwin-arm64`, `aid-linux-x64`, and so on), verifies the SHA-256 digest GitHub assigns to the asset, runs the staged binary's hidden `__selfcheck`, and then atomically swaps it into place. It refuses to run from source (`bun run`) and, on Windows where a running executable cannot be replaced, prints the staged path for a manual swap.

## Release a new version

The release version lives in the root `package.json`. To publish a release:

1. Bump the version in the root `package.json` (for example to `0.2.0`) and commit it.
2. Tag and push the tag — the tag must match the version: `git tag v0.2.0 && git push origin v0.2.0`.
3. The release workflow cross-compiles the four binaries (`aid-darwin-arm64`, `aid-darwin-x64`, `aid-linux-x64`, `aid-windows-x64.exe`), verifies the tag matches the package version, smoke-tests the Linux binary, and creates a GitHub release with all platform assets.

The workflow fails fast if the tag does not match `package.json`, so a mismatched tag never publishes binaries that would confuse `self-update`.

## Checks

```sh
pnpm typecheck
pnpm test
pnpm build
```

CI also runs a `release-smoke` job that builds the Linux binary, checks `--version`, `--help`, and `__selfcheck`, then starts `aid web` and asserts the embedded SPA and the `/health` version match the release version.

## Repository boundary

The application repository stores code. The separate registry repository stores versioned resource packages, metadata, and bundles.
