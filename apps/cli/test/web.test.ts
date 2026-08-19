import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliEntry = join(packageRoot, 'src', 'main.ts');
const registryIndex = join(
  packageRoot,
  '..',
  '..',
  'packages',
  'registry',
  'test',
  'fixtures',
  'index.json',
);

describe('CLI web server', () => {
  it('serves the SPA shell, deep links, assets, and API routes', async () => {
    const child = spawn(
      'bun',
      ['run', cliEntry, '--', 'web', '--host', '127.0.0.1', '--port', '0', '--index', registryIndex],
      {
        cwd: packageRoot,
        env: { ...process.env, AI_DIRECTORY_REGISTRY_INDEX: registryIndex },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    try {
      const port = await waitForPort(child);
      const baseUrl = `http://127.0.0.1:${port}`;
      const root = await fetch(`${baseUrl}/`);
      const html = await root.text();
      const assetPath = html.match(/src="([^"]+\.js)"/)?.[1];

      expect(root.status).toBe(200);
      expect(html).toContain('<div id="root"></div>');
      expect(assetPath).toBeDefined();

      const deepLink = await fetch(`${baseUrl}/resources/john-doe/skills/typescript-review`);
      expect(deepLink.status).toBe(200);
      await expect(deepLink.text()).resolves.toContain('<div id="root"></div>');

      const asset = await fetch(`${baseUrl}${assetPath}`);
      expect(asset.status).toBe(200);
      expect(asset.headers.get('content-type')).toContain('text/javascript');

      const health = await fetch(`${baseUrl}/health`);
      expect(health.status).toBe(200);
      await expect(health.json()).resolves.toEqual({ ok: true });

      const registry = await fetch(`${baseUrl}/api/registry`);
      expect(registry.status).toBe(200);
      await expect(registry.json()).resolves.toMatchObject({
        index: { resources: expect.arrayContaining([expect.objectContaining({ name: 'typescript-review' })]) },
      });
    } finally {
      await stopProcess(child);
    }
  }, 15_000);
});

async function waitForPort(child: ReturnType<typeof spawn>): Promise<number> {
  return new Promise((resolvePort, reject) => {
    let output = '';
    const timeout = setTimeout(() => {
      child.kill('SIGINT');
      reject(new Error(`Timed out waiting for the web server. Output: ${output}`));
    }, 10_000);

    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const port = output.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/)?.[1];
      if (!port) return;
      clearTimeout(timeout);
      resolvePort(Number(port));
    });
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      if (code !== null) {
        clearTimeout(timeout);
        reject(new Error(`The web server exited before listening. Output: ${output}`));
      }
    });
  });
}

async function stopProcess(child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null) return;
  child.kill('SIGINT');
  await once(child, 'exit');
}
