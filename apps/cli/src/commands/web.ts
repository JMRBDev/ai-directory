import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { defineCommand } from 'citty';
import { createApp, generatePairingToken, type ServerOptions } from '@ai-directory/server-core';
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

const EMBEDDED_ROOT = join(import.meta.dir, 'dist');

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
    'no-token': {
      type: 'boolean',
      description: 'Allow cross-origin API access without a pairing token (unsafe for LAN)',
    },
  },
  async run({ args }) {
    const workspaceRoot = findWorkspaceRoot(process.cwd());
    const indexPath = args.index
      ? resolve(workspaceRoot ?? process.cwd(), args.index)
      : undefined;
    const webDist = findWebDist(workspaceRoot);
    const embedded = await hasEmbeddedWeb();

    if (!webDist && !embedded) {
      console.error('Built website assets were not found. Run `pnpm --filter @ai-directory/web build` first.');
      process.exitCode = 1;
      return;
    }

    const host = args.host ?? DEFAULT_API_HOST;
    const port = Number(args.port ?? '4321');
    const cwd = resolve(process.cwd());
    const pairingToken = args['no-token'] ? undefined : generatePairingToken();
    const serverOptions: ServerOptions = { cwd, homeDirectory: homedir(), prewarm: true, version };
    if (indexPath) serverOptions.registryIndexPath = indexPath;
    if (pairingToken) serverOptions.pairingTokens = [pairingToken];
    const app = createApp(serverOptions);
    const server = Bun.serve({
      hostname: host,
      port,
      fetch: async (request) => {
        const pathname = new URL(request.url).pathname;
        if (pathname === '/health' || pathname.startsWith('/api/')) return app.fetch(request);
        if (webDist) return serveStatic(request, webDist);
        return serveEmbedded(request);
      },
    });
    const url = `http://${host}:${server.port}`;

    console.log(`AI Directory website listening on ${url}`);
    console.log(webDist ? `Serving static assets from ${webDist}` : 'Serving embedded website assets from the binary.');
    console.log(`Registry source: ${indexPath ?? 'configured Git repository'}`);
    if (pairingToken) {
      console.log(`Pairing token: ${pairingToken}`);
      console.log('Enter this URL and token in Settings → Local connection to control this setup from the hosted website.');
    } else {
      console.log('Cross-origin API access is open (--no-token).');
    }

    if (args.open) openBrowser(url);
    await new Promise<void>((resolvePromise) => {
      process.once('SIGINT', () => {
        server.stop();
        resolvePromise();
      });
    });
  },
});

function findWebDist(workspaceRoot: string | null): string | undefined {
  const candidates = [
    process.env.AI_DIRECTORY_WEB_DIST,
    workspaceRoot ? join(workspaceRoot, 'apps', 'web', 'dist') : undefined,
    join(dirname(process.execPath), 'web'),
    join(dirname(process.execPath), 'web', 'dist'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => existsSync(join(candidate, 'index.html')));
}

function embeddedPath(pathname: string): string {
  const normalized = pathname.replace(/\/+/u, '/');
  const relative = normalized === '/' || normalized === ''
    ? 'index.html'
    : normalized.startsWith('/')
      ? normalized.slice(1)
      : normalized;
  return join(EMBEDDED_ROOT, relative);
}

async function hasEmbeddedWeb(): Promise<boolean> {
  return Bun.file(embeddedPath('index.html')).exists();
}

async function serveEmbedded(request: Request): Promise<Response> {
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

  const requested = embeddedPath(pathname);
  const directFile = Bun.file(requested);
  const isDirect = await directFile.exists();

  const fallbackFile = Bun.file(embeddedPath('index.html'));
  const file = isDirect || pathname.includes('.') ? directFile : fallbackFile;

  if (!await file.exists()) return new Response('Not found', { status: 404 });

  const headers = new Headers({
    'cache-control': pathname === '/' || pathname.startsWith('/resources/')
      ? 'no-cache'
      : 'public, max-age=31536000, immutable',
  });
  const extension = (file.name ?? requested).slice((file.name ?? requested).lastIndexOf('.')).toLowerCase();
  const contentType = Object.entries(CONTENT_TYPES).find(([suffix]) => suffix === extension)?.[1];
  if (contentType) headers.set('content-type', contentType);
  return new Response(request.method === 'HEAD' ? null : file, { headers });
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

  const directFile = await Bun.file(requestedPath).exists();
  const fallbackPath = join(rootPath, 'index.html');
  const filePath = directFile || pathname.includes('.') ? requestedPath : fallbackPath;
  if (!await Bun.file(filePath).exists()) return new Response('Not found', { status: 404 });

  const file = Bun.file(filePath);
  const headers = new Headers({
    'cache-control': pathname === '/' || pathname.startsWith('/resources/')
      ? 'no-cache'
      : 'public, max-age=31536000, immutable',
  });
  const extension = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  const contentType = Object.entries(CONTENT_TYPES).find(([suffix]) => suffix === extension)?.[1];
  if (contentType) headers.set('content-type', contentType);
  return new Response(request.method === 'HEAD' ? null : file, { headers });
}

function openBrowser(url: string) {
  const command = process.platform === 'darwin'
    ? 'open'
    : process.platform === 'win32'
      ? 'start'
      : 'xdg-open';
  void Bun.spawn([command, url], { stdout: 'ignore', stderr: 'ignore' });
}
