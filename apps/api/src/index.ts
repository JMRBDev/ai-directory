import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from '@ai-directory/server-core';

function findWorkspaceRoot(startDirectory: string): string | null {
  let directory = resolve(startDirectory);

  while (true) {
    if (existsSync(join(directory, 'pnpm-workspace.yaml'))) return directory;

    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

const port = Number(process.env.AI_DIRECTORY_PORT ?? 4317);
const host = process.env.AI_DIRECTORY_HOST ?? '127.0.0.1';
const cwd =
  process.env.AI_DIRECTORY_CONFIG_CWD ?? findWorkspaceRoot(process.cwd()) ?? process.cwd();

serve({
  fetch: createApp({ cwd }).fetch,
  hostname: host,
  port,
}, (info) => {
  console.log(`AI Directory API listening on http://${host}:${info.port}`);
});
