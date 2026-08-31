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

async function sessionFor(app: ReturnType<typeof createApp>, pairingToken: string): Promise<string> {
  const response = await postJson(app, '/api/auth/sessions', { token: pairingToken }, { origin: 'https://ai-directory.example.com' });
  expect(response.status).toBe(201);
  // SAFETY: The sessions endpoint is contract-tested and returns a sessionToken on success.
  const body = await response.json() as { sessionToken: string };
  return body.sessionToken;
}

describe('pairing handshake', () => {
  it('generates a non-empty token', () => {
    const token = generatePairingToken();
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(generatePairingToken()).not.toBe(token);
  });

  it('allows same-origin requests without a token', async () => {
    const cwd = await createTemporaryDirectory();
    const app = createApp({ cwd, pairingTokens: ['secret'] });

    const response = await app.request('/api/config', {
      headers: { origin: 'http://127.0.0.1:4321', host: '127.0.0.1:4321' },
    });

    expect(response.status).toBe(200);
  });

  it('rejects a cross-origin request without a session token', async () => {
    const cwd = await createTemporaryDirectory();
    const app = createApp({ cwd, pairingTokens: ['secret'] });

    const response = await postJson(app, '/api/refresh', {}, { origin: 'https://ai-directory.example.com' });

    expect(response.status).toBe(401);
  });

  it('exchanges the pairing token once for a session token', async () => {
    const cwd = await createTemporaryDirectory();
    const app = createApp({ cwd, pairingTokens: ['secret'] });

    const first = await postJson(app, '/api/auth/sessions', { token: 'secret' }, { origin: 'https://ai-directory.example.com' });
    expect(first.status).toBe(201);
    // SAFETY: The sessions endpoint is contract-tested and returns this exact shape on success.
    const body = await first.json() as { sessionToken: string; session: { id: string; label: string } };
    expect(body.sessionToken).toMatch(/^[0-9a-f]{32}$/);
    expect(body.session.id).toMatch(/^[0-9a-f]{64}$/);
    expect(body.session.label).toContain('ai-directory.example.com');

    const second = await postJson(app, '/api/auth/sessions', { token: 'secret' }, { origin: 'https://ai-directory.example.com' });
    expect(second.status).toBe(401);
  });

  it('does not accept the pairing token as a session token', async () => {
    const cwd = await createTemporaryDirectory();
    const app = createApp({ cwd, pairingTokens: ['secret'] });

    const response = await postJson(app, '/api/refresh', {}, {
      origin: 'https://ai-directory.example.com',
      authorization: 'Bearer secret',
    });

    expect(response.status).toBe(401);
  });

  it('accepts a cross-origin request with a valid session token', async () => {
    const cwd = await createTemporaryDirectory();
    const app = createApp({ cwd, pairingTokens: ['secret'] });
    const sessionToken = await sessionFor(app, 'secret');

    const response = await postJson(app, '/api/refresh', {}, {
      origin: 'https://ai-directory.example.com',
      authorization: `Bearer ${sessionToken}`,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('rejects a cross-origin request with a wrong session token', async () => {
    const cwd = await createTemporaryDirectory();
    const app = createApp({ cwd, pairingTokens: ['secret'] });
    const sessionToken = await sessionFor(app, 'secret');

    const response = await postJson(app, '/api/refresh', {}, {
      origin: 'https://ai-directory.example.com',
      authorization: `Bearer ${sessionToken.slice(0, -1)}x`,
    });

    expect(response.status).toBe(401);
  });

  it('lists active sessions only with a valid session token', async () => {
    const cwd = await createTemporaryDirectory();
    const app = createApp({ cwd, pairingTokens: ['secret'] });
    const sessionToken = await sessionFor(app, 'secret');

    const anonymous = await app.request('/api/auth/sessions', { headers: { origin: 'https://ai-directory.example.com' } });
    expect(anonymous.status).toBe(401);

    const listed = await app.request('/api/auth/sessions', {
      headers: { origin: 'https://ai-directory.example.com', authorization: `Bearer ${sessionToken}` },
    });
    expect(listed.status).toBe(200);
    // SAFETY: The sessions endpoint is contract-tested and returns a sessions array on success.
    const body = await listed.json() as { sessions: Array<{ id: string; label: string }> };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]?.label).toContain('ai-directory.example.com');
  });

  it('revokes a session so it can no longer access the API', async () => {
    const cwd = await createTemporaryDirectory();
    const app = createApp({ cwd, pairingTokens: ['secret'] });
    const sessionToken = await sessionFor(app, 'secret');

    const sessions = await app.request('/api/auth/sessions', {
      headers: { origin: 'https://ai-directory.example.com', authorization: `Bearer ${sessionToken}` },
    });
    // SAFETY: The sessions endpoint is contract-tested and returns a sessions array on success.
    const { sessions: list } = await sessions.json() as { sessions: Array<{ id: string }> };
    const revoked = await app.request(`/api/auth/sessions/${list[0]?.id}`, {
      method: 'DELETE',
      headers: { origin: 'https://ai-directory.example.com', authorization: `Bearer ${sessionToken}` },
    });
    expect(revoked.status).toBe(200);
    await expect(revoked.json()).resolves.toEqual({ ok: true });

    const response = await postJson(app, '/api/refresh', {}, {
      origin: 'https://ai-directory.example.com',
      authorization: `Bearer ${sessionToken}`,
    });
    expect(response.status).toBe(401);
  });

  it('passes OPTIONS preflight without a token', async () => {
    const cwd = await createTemporaryDirectory();
    const app = createApp({ cwd, pairingTokens: ['secret'] });

    const response = await app.request('/api/registry', {
      method: 'OPTIONS',
      headers: { origin: 'https://ai-directory.example.com' },
    });

    expect(response.status).toBe(204);
  });

  it('stays open to cross-origin requests when no pairing tokens are configured', async () => {
    const cwd = await createTemporaryDirectory();
    const app = createApp({ cwd });

    const response = await postJson(app, '/api/refresh', {}, { origin: 'https://ai-directory.example.com' });

    expect(response.status).toBe(200);
  });

  it('does not require a token for the health endpoint', async () => {
    const cwd = await createTemporaryDirectory();
    const app = createApp({ cwd, pairingTokens: ['secret'] });

    const response = await app.request('/health', {
      headers: { origin: 'https://ai-directory.example.com' },
    });

    expect(response.status).toBe(200);
  });
});
