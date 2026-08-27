import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, generatePairingToken } from '../src/index.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ai-directory-pairing-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function postJson(app: ReturnType<typeof createApp>, path: string, body: Record<string, string>, init: HeadersInit = {}): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...init },
    body: JSON.stringify(body),
  });
}

describe('pairing token', () => {
  it('generates a non-empty token', () => {
    const token = generatePairingToken();
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(generatePairingToken()).not.toBe(token);
  });

  it('allows same-origin requests without a token', async () => {
    const cwd = await createTemporaryDirectory();
    const app = createApp({ cwd, pairingToken: 'secret' });

    const response = await app.request('/api/config', {
      headers: { origin: 'http://127.0.0.1:4321', host: '127.0.0.1:4321' },
    });

    expect(response.status).toBe(200);
  });

  it('rejects a cross-origin request without the token', async () => {
    const cwd = await createTemporaryDirectory();
    const app = createApp({ cwd, pairingToken: 'secret' });

    const response = await postJson(app, '/api/refresh', {}, { origin: 'https://ai-directory.example.com' });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: 'The local API requires a pairing token from `aid web`.',
    });
  });

  it('accepts a cross-origin request with the correct token', async () => {
    const cwd = await createTemporaryDirectory();
    const app = createApp({ cwd, pairingToken: 'secret' });

    const response = await postJson(app, '/api/refresh', {}, {
      origin: 'https://ai-directory.example.com',
      authorization: 'Bearer secret',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('rejects a cross-origin request with the wrong token', async () => {
    const cwd = await createTemporaryDirectory();
    const app = createApp({ cwd, pairingToken: 'secret' });

    const response = await postJson(app, '/api/refresh', {}, {
      origin: 'https://ai-directory.example.com',
      authorization: 'Bearer wrong',
    });

    expect(response.status).toBe(401);
  });

  it('passes OPTIONS preflight without a token', async () => {
    const cwd = await createTemporaryDirectory();
    const app = createApp({ cwd, pairingToken: 'secret' });

    const response = await app.request('/api/registry', {
      method: 'OPTIONS',
      headers: { origin: 'https://ai-directory.example.com' },
    });

    expect(response.status).toBe(204);
  });

  it('stays open to cross-origin requests when no token is configured', async () => {
    const cwd = await createTemporaryDirectory();
    const app = createApp({ cwd });

    const response = await postJson(app, '/api/refresh', {}, { origin: 'https://ai-directory.example.com' });

    expect(response.status).toBe(200);
  });

  it('does not require the token for the health endpoint', async () => {
    const cwd = await createTemporaryDirectory();
    const app = createApp({ cwd, pairingToken: 'secret' });

    const response = await app.request('/health', {
      headers: { origin: 'https://ai-directory.example.com' },
    });

    expect(response.status).toBe(200);
  });
});
