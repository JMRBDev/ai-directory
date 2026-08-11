# AI Directory

AI Directory is an internal, Git-backed registry for reusable AI development resources.

The repository is a Turborepo monorepo. It contains the local website, the Hono server boundary, the Bun CLI, and shared TypeScript packages. The company resource registry is a separate Git repository and is not stored in this application repository.

## Stack

- Turborepo and pnpm workspaces
- TypeScript
- Hono for the local and hosted HTTP application boundary
- Astro for the website
- Bun for the CLI runtime and release binaries
- Citty for CLI commands and flags
- `@clack/prompts` for interactive CLI flows

## Workspace

```text
apps/
  api/              Hosted Hono entrypoint
  cli/              Bun CLI entrypoint
  web/              Astro website

packages/
  contracts/        Shared API and registry contracts
  domain/           Resource and version rules
  installers/       Harness adapter boundary
  registry/         Git-backed registry boundary
  server-core/      Reusable Hono application
```

## Start development

```sh
pnpm install
pnpm dev
```

The workspace contains the first discovery slices. Product behavior will continue to be added in small vertical slices.

## Resource discovery

The first feature reads a validated registry index and lists active resources:

```sh
pnpm build
apps/cli/dist/aid list --index /path/to/registry/index.json
```

To read the index directly from the Git server without cloning the repository:

```sh
apps/cli/dist/aid list --remote https://git.company.internal/raw/main/index.json
```

The default index path is `.ai-directory/registry/index.json`. Set `AI_DIRECTORY_REGISTRY_INDEX` or `AI_DIRECTORY_REGISTRY_INDEX_URL` to change the local or remote source. Use `--type`, `--include-retired`, or `--json` to filter the result.

Inspect a version from the linked local registry:

```sh
apps/cli/dist/aid show jose-rosendo/skills/typescript-api-review
```

Use `--version` to inspect a specific version or `--json` for machine-readable output.

Validate the linked registry before using it:

```sh
apps/cli/dist/aid check
```

## Checks

```sh
pnpm typecheck
pnpm test
pnpm build
```

## Repository boundary

The application repository stores code. The separate registry repository stores versioned resource packages, metadata, and bundles.
