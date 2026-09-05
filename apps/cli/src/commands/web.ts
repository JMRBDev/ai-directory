import { spawn } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineCommand } from 'citty';
import { serve } from '@hono/node-server';
import { createApp, type ServerOptions } from '@ai-directory/server-core';
import { DEFAULT_API_HOST, findWorkspaceRoot } from '@ai-directory/config';
import { version } from '../version';

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
} satisfies Record<string, string>;

// Directory of the compiled CLI entrypoint (dist/ when published).
const cliDir = dirname(fileURLToPath(import.meta.url));

export const web = defineCommand({
  meta: {
    name: 'web',
    description: 'Start the local AI Directory website',
  },
  args: {
    index: {
      type: 'string',
      alias: 'i',
      description: 'Local registry index path; overrides the configured Git repository',
    },
    host: {
      type: 'string',
      default: DEFAULT_API_HOST,
      description: 'Host for the local website and API',
    },
    port: {
      type: 'string',
      default: '4321',
      description: 'Port for the local website and API',
    },
    open: {
      type: 'boolean',
      description: 'Open the website in the default browser',
    },
  },
  async run({ args }) {
    const workspaceRoot = findWorkspaceRoot(process.cwd());
    const indexPath = args.index
      ? resolve(workspaceRoot ?? process.cwd(), args.index)
      : undefined;
    const webDir = findWebDir(workspaceRoot, cliDir);

    if (!webDir) {
      console.error('Built website assets were not found. Run `pnpm --filter @ai-directory/web build` first.');
      process.exitCode = 1;
      return;
    }

    const host = args.host ?? DEFAULT_API_HOST;
    const port = Number(args.port ?? '4321');
    const cwd = resolve(process.cwd());
    const serverOptions: ServerOptions = { cwd, homeDirectory: homedir(), prewarm: true, version };
    if (indexPath) serverOptions.registryIndexPath = indexPath;
    const app = createApp(serverOptions);

    serve({
      fetch: async (request) => {
        const pathname = new URL(request.url).pathname;
        if (pathname === '/health' || pathname.startsWith('/api/')) return app.fetch(request);
        return serveStatic(request, webDir);
      },
      port,
      hostname: host,
    }, (info) => {
      const url = `http://${host}:${info.port}`;

      console.log(`AI Directory website listening on ${url}`);
      console.log(`Serving website assets from ${webDir}`);
      console.log(`Registry source: ${indexPath ?? 'configured Git repository'}`);

      if (args.open) openBrowser(url);
    });
  },
});

function findWebDir(workspaceRoot: string | null, packageDir: string): string | undefined {
  const candidates = [
    process.env.AI_DIRECTORY_WEB_DIST,
    workspaceRoot ? join(workspaceRoot, 'apps', 'web', 'dist') : undefined,
    // Published npm layout: dist/main.js next to dist/web/index.html.
    join(packageDir, 'web'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => existsSync(join(candidate, 'index.html')));
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isFile();
  } catch {
    return false;
  }
}

async function serveStatic(request: Request, root: string): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }

  const url = new URL(request.url);
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const rootPath = resolve(root);
  const requestedPath = resolve(rootPath, `.${pathname === '/' ? '/index.html' : pathname}`);
  const isInsideRoot = requestedPath === rootPath || requestedPath.startsWith(rootPath + sep);
  if (!isInsideRoot) return new Response('Forbidden', { status: 403 });

  let filePath = requestedPath;
  if (!await fileExists(filePath) && !pathname.includes('.')) {
    filePath = join(rootPath, 'index.html');
  }
  if (!await fileExists(filePath)) return new Response('Not found', { status: 404 });

  const headers = new Headers({
    'cache-control': pathname === '/' || pathname.startsWith('/resources/')
      ? 'no-cache'
      : 'public, max-age=31536000, immutable',
  });
  const extension = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  const contentType = Object.entries(CONTENT_TYPES).find(([suffix]) => suffix === extension)?.[1];
  if (contentType) headers.set('content-type', contentType);
  if (request.method === 'HEAD') return new Response(null, { headers });
  return new Response(await fs.readFile(filePath), { headers });
}

function openBrowser(url: string) {
  const command = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32'
      ? 'start'
      : 'xdg-open';
  const child = spawn(command, [url], {
    stdio: 'ignore',
    detached: true,
    shell: process.platform === 'win32',
  });
  child.unref();
}
