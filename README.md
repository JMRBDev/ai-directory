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

The workspace currently contains only bootstraps and package boundaries. Product behavior will be added in vertical slices.

## Checks

```sh
pnpm typecheck
pnpm test
pnpm build
```

## Repository boundary

The application repository stores code. The separate registry repository stores versioned resource packages, metadata, and bundles. See [docs/registry-repository.md](docs/registry-repository.md).
