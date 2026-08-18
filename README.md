# AI Directory

AI Directory is an internal, Git-backed registry for reusable AI development resources.

The repository is a Turborepo monorepo. It contains the local website, the Hono server boundary, the Bun CLI, and shared TypeScript packages. The company resource registry is a separate Git repository and is not stored in this application repository.

## Stack

- Turborepo and pnpm workspaces
- TypeScript
- Hono for the local HTTP application boundary
- Astro for the website
- Bun for the CLI runtime and release binaries
- Citty for CLI commands and flags
- `@clack/prompts` for interactive CLI flows

## Workspace

```text
apps/
  api/              Local Hono entrypoint
  cli/              Bun CLI entrypoint
  web/              Astro website

packages/
  config/          Shared user/project configuration
  contracts/        Shared API and registry contracts
  installers/       Harness adapter boundary
  registry/         Git-backed registry boundary
  server-core/      Reusable Hono application
```

## Start development

```sh
pnpm install
pnpm dev
```

The root `dev` command starts the long-running API and website. The CLI is interactive or command-driven and is not part of that process; run it directly with `apps/cli/dist/aid ...` after `pnpm build`. The workspace contains the first discovery slices. Product behavior will continue to be added in small vertical slices.

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
  --owner jose-rosendo \
  --description "Review TypeScript changes." \
  --output ./my-skill
```

The command creates the required entry file (`SKILL.md`, `AGENT.md`, `RULE.md`, or `TEMPLATE.md`). Add supporting files as needed, then use the printed `aid submit` command. Templates can contain existing resources with `--resources owner/type/name@version,...`.

Validate a resource before submitting it:

```sh
apps/cli/dist/aid validate ./my-skill \
  --id jose-rosendo/skills/my-resource \
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

Set the company registry once for the current user:

```sh
apps/cli/dist/aid config set repository \
  git@github.com:company/ai-directory-registry.git
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
  --repository git@github.com:company/ai-directory-registry.git \
  --scope user \
  --non-interactive
```

Check the configuration and registry connection at any time:

```sh
apps/cli/dist/aid doctor
apps/cli/dist/aid doctor --json
```

The CLI uses the Git credentials already configured on the employee's machine. It does not store Git credentials in AI Directory configuration.

## Run the local catalog

The website is local-first. It reads the same registry index as the CLI and starts a loopback Hono control API for local settings. It does not require a hosted service:

```sh
pnpm build
apps/cli/dist/aid web --open
```

Use the Settings control in the catalog or publishing page to configure the registry repository from the browser. The drawer writes through the local API, so the CLI and website share the same user/project configuration. Use `--index`, `--host`, `--port`, or `--api-port` to change the local setup. The command starts Astro and the local API from the workspace.

Open `/publish/` to submit a resource from the website. The page fills the authenticated GitHub username, then lets you choose the resource type and name, select its directory, and enter its version. AI Directory infers the registry description from the entry file. Validate it locally, review the summary, then confirm the pull request. The local API keeps the uploaded files in a temporary directory and removes them after validation or submission. Website publishing requires the configured source to be a Git repository and uses the employee's existing Git and GitHub CLI credentials. Use `Refresh registry` on the catalog after a pull request is merged to fetch the latest production branch.

Inspect a version from the configured registry:

```sh
apps/cli/dist/aid show jose-rosendo/skills/typescript-api-review
```

Use `--version` to inspect a specific version or `--json` for machine-readable output.

Pass a repository for a one-command override:

```sh
apps/cli/dist/aid show jose-rosendo/skills/typescript-api-review \
  --repository git@github.com:company/ai-directory-registry.git
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

Prepare a resource directory with its required entry file (`SKILL.md`, `AGENT.md`, `RULE.md`, or `TEMPLATE.md`) and publish it to the linked registry:

```sh
apps/cli/dist/aid submit ./my-resource \
  --id jose-rosendo/skills/my-resource \
  --version 1.0.0 \
  --description "Short resource description"
```

The command uses a temporary partial checkout. It does not keep a full registry copy on the employee's computer. The command creates a branch, copies the package, updates `index.json`, commits and pushes the branch, and opens a pull request through the authenticated GitHub CLI. The production branch remains unchanged until reviewers merge the pull request.

In an interactive terminal, `submit` validates the local inputs and asks for confirmation before it creates the branch and pull request.

The same remote checkout mode is available during installation:

```sh
apps/cli/dist/aid install jose-rosendo/skills/typescript-api-review \
  --scope project --harness claude-code
```

Select the target harness when needed:

```sh
apps/cli/dist/aid install jose-rosendo/skills/typescript-api-review \
  --harness opencode --scope project

apps/cli/dist/aid install jose-rosendo/skills/typescript-api-review \
  --harness codex --scope project
```

The installers use explicit harness adapters. The current prototype uses documented native filesystem mechanisms: project OpenCode rules are stored in `.opencode/rules/` and registered in `opencode.json` or `opencode.jsonc` through its `instructions` field; project Codex rules are stored in `.ai-directory/rules/` and added as managed blocks to `AGENTS.override.md` or `AGENTS.md`; Codex agents are converted from the registry's `AGENT.md` to `.codex/agents/<name>.toml`. Existing user content remains unchanged. The adapters honor `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `OPENCODE_CONFIG`, and `OPENCODE_CONFIG_DIR` when those harnesses provide them.

Project installations are recorded in `.ai-directory/installed.json`. Global installations are recorded in the user's AI Directory data directory. List tracked installations and update one resource from the latest production version:

```sh
apps/cli/dist/aid installed
apps/cli/dist/aid update jose-rosendo/skills/typescript-api-review \
  --scope project
```

Template installations are expanded into their component resources. Use `installed` to see those components and update them individually.

## Checks

```sh
pnpm typecheck
pnpm test
pnpm build
```

## Repository boundary

The application repository stores code. The separate registry repository stores versioned resource packages, metadata, and bundles.
