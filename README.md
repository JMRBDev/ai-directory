# AI Directory

Browse a Git-backed catalog of AI dev resources (skills, agents, rules, MCP servers, packs, tools) and install them into your coding harnesses (Claude Code, OpenCode, Codex).

Two pieces, one machine:

- **CLI (`aid`)** — npm package `@jmrbdev/ai-directory`. Installs resources, serves the local API.
- **Website** — served by `aid web` from the same process. Open it in your browser; it talks to the local server directly.

## Install the CLI

Requires Node 24 or later.

```sh
npm install --global @jmrbdev/ai-directory
```

Or try it without installing:

```sh
npx @jmrbdev/ai-directory --help
```

## Point it at your registry

```sh
aid setup --repository git@github.com:you/ai-directory-registry.git --non-interactive
```

## Browse and install

```sh
aid list
aid install octocat/skills/typescript-api-review --harness claude-code
```

Or open the local website:

```sh
aid web --open
```

Install, update, and uninstall from the catalog or Installed panels. Manage the harness apps themselves from Settings or `aid harness list`.

## Develop

```sh
pnpm install
pnpm dev      # website + local API
pnpm build    # build all
```

The website build lives in `apps/web/dist`. The CLI build copies it into `apps/cli/dist/web`, so `aid web` serves site + API from the npm package.

## Publish the CLI

Push a version tag; CI publishes to npm with provenance:

```sh
npm version patch  # or minor / major, from the repo root
git push --follow-tags
```
