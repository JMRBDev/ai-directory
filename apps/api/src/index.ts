import { serve } from '@hono/node-server';
import {
  DEFAULT_API_HOST,
  DEFAULT_API_PORT,
  findWorkspaceRoot,
} from '@ai-directory/config';
import { createApp } from '@ai-directory/server-core';

const port = Number(process.env.AI_DIRECTORY_PORT ?? DEFAULT_API_PORT);
const host = process.env.AI_DIRECTORY_HOST ?? DEFAULT_API_HOST;
const cwd =
  process.env.AI_DIRECTORY_CONFIG_CWD ?? findWorkspaceRoot(process.cwd()) ?? process.cwd();

serve({
  fetch: createApp({ cwd }).fetch,
  hostname: host,
  port,
}, (info) => {
  console.log(`AI Directory API listening on http://${host}:${info.port}`);
});
