# Contributing

Thanks for your interest in AI Directory. This document covers how to set up the project and what to expect when opening a pull request.

## Requirements

- Node.js 24+
- pnpm 11
- Bun 1.3+

## Setup

```sh
pnpm install
```

Install the development CLI and run the website + API:

```sh
pnpm dev
```

Run the CLI from source without building the binary:

```sh
pnpm --filter @ai-directory/cli dev -- list
```

## Checks

Before submitting a pull request, run the full suite:

```sh
pnpm typecheck
pnpm lint
pnpm test
```

All three must pass. The CI workflow runs the same commands on every push and pull request.

## Project layout

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

## Design notes

- **Harnesses** are first-class citizens. Adding one means updating the `Harness` contract, the harness catalog in `packages/installers/src/harnesses.ts`, a plan installer under `packages/installers/src/plans/`, the adapter capability map, and the web/CLI option lists. The `pi` harness is a recent example to follow.
- **Registries are external.** The resource registry is a separate Git repository that users configure. This repository only stores code.
- **Tests** live next to each package in `test/`. Prefer integration-style tests that exercise real filesystem and command-runnner behavior over mocks where practical.

## Pull requests

Keep changes focused and describe the motivation in the pull request body. Include tests for new behavior and run the checks above. For larger features, open an issue or discussion first so the design can be reviewed.
