import { serve } from '@hono/node-server';
import { createApp } from '@ai-directory/server-core';

const port = Number(process.env.AI_DIRECTORY_PORT ?? 4317);

serve({
  fetch: createApp().fetch,
  port,
}, (info) => {
  console.log(`AI Directory API listening on http://localhost:${info.port}`);
});
