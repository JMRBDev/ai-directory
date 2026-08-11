import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readConfigFile } from '@ai-directory/config';
import { createApp } from '../src/index.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('local control API', () => {
  it('reports health and manages project configuration', async () => {
    const cwd = await createTemporaryDirectory();
    const app = createApp({ cwd });

    expect((await app.request('/health')).status).toBe(200);

    const save = await app.request('/api/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        repository: 'git@github.com:company/registry.git',
        scope: 'project',
      }),
    });

    expect(save.status).toBe(200);
    await expect(save.json()).resolves.toMatchObject({
      repository: 'git@github.com:company/registry.git',
      source: 'project',
      savedScope: 'project',
    });
    expect(readConfigFile(join(cwd, '.ai-directory', 'config.json'))).toEqual({
      repository: 'git@github.com:company/registry.git',
    });

    const clear = await app.request('/api/config?scope=project', { method: 'DELETE' });
    expect(clear.status).toBe(200);
    await expect(clear.json()).resolves.toMatchObject({ clearedScope: 'project' });
    expect(readConfigFile(join(cwd, '.ai-directory', 'config.json'))).toEqual({});
  });

  it('rejects invalid configuration requests', async () => {
    const app = createApp({ cwd: await createTemporaryDirectory() });

    const response = await app.request('/api/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repository: '', scope: 'user' }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'repository must be a non-empty string.',
    });

    const objectResponse = await app.request('/api/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(null),
    });

    expect(objectResponse.status).toBe(400);
    await expect(objectResponse.json()).resolves.toEqual({
      error: 'Request body must be a JSON object.',
    });
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ai-directory-server-'));
  temporaryDirectories.push(directory);
  return directory;
}
