import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readConfigFile } from '@ai-directory/config';
import { createApp } from '../src/index.js';

const temporaryDirectories: string[] = [];
const fixtureIndexPath = fileURLToPath(
  new URL('../../registry/test/fixtures/index.json', import.meta.url),
);
const templateIndexPath = fileURLToPath(
  new URL('../../registry/test/fixtures/template-index.json', import.meta.url),
);

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

  it('installs one resource for multiple harnesses and safely uninstalls it', async () => {
    const cwd = await createTemporaryDirectory();
    const app = createApp({ cwd, registryIndexPath: fixtureIndexPath });
    const request = {
      resource: 'john-doe/skills/typescript-review',
      harnesses: ['claude-code', 'opencode'],
      scope: 'project',
    };

    const install = await app.request('/api/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });

    expect(install.status).toBe(200);
    await expect(install.json()).resolves.toMatchObject({
      resource: { version: '1.2.0' },
      harnesses: request.harnesses,
      records: request.harnesses.map(() =>
        expect.objectContaining({
          resource: request.resource,
          fileHashes: expect.any(Object),
        }),
      ),
    });

    const skillPath = join(cwd, '.claude', 'skills', 'typescript-review', 'SKILL.md');
    const openCodeSkillPath = join(cwd, '.opencode', 'skills', 'typescript-review', 'SKILL.md');
    await expect(readFile(skillPath, 'utf8')).resolves.toContain('TypeScript');
    await expect(readFile(openCodeSkillPath, 'utf8')).resolves.toContain('TypeScript');

    const listed = await app.request('/api/installed?scope=project');
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      installations: request.harnesses.map((harness) =>
        expect.objectContaining({ resource: request.resource, harness }),
      ),
    });

    await writeFile(skillPath, '# Local edit\n', 'utf8');
    const blocked = await app.request(
      `/api/installed?resource=${encodeURIComponent(request.resource)}&harnesses=${encodeURIComponent(request.harnesses.join(','))}&scope=project`,
      { method: 'DELETE' },
    );
    expect(blocked.status).toBe(400);
    await expect(readFile(skillPath, 'utf8')).resolves.toBe('# Local edit\n');
    await expect(readFile(openCodeSkillPath, 'utf8')).resolves.toContain('TypeScript');

    const forced = await app.request(
      `/api/installed?resource=${encodeURIComponent(request.resource)}&harnesses=${encodeURIComponent(request.harnesses.join(','))}&scope=project&force=true`,
      { method: 'DELETE' },
    );
    expect(forced.status).toBe(200);
    await expect(readFile(skillPath, 'utf8')).rejects.toThrow();
    await expect(readFile(openCodeSkillPath, 'utf8')).rejects.toThrow();

    await expect(app.request('/api/installed?scope=project').then((response) => response.json())).resolves.toEqual({
      installations: [],
    });
  });

  it('installs and uninstalls a template pack by its template ID', async () => {
    const cwd = await createTemporaryDirectory();
    const app = createApp({ cwd, registryIndexPath: templateIndexPath });
    const request = {
      resource: 'john-doe/templates/review-pack',
      harnesses: ['codex', 'opencode'],
      scope: 'project',
    };

    const install = await app.request('/api/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });

    expect(install.status).toBe(200);
    await expect(install.json()).resolves.toMatchObject({
      resource: { resource: { type: 'templates' } },
      harnesses: request.harnesses,
      records: expect.arrayContaining([
        expect.objectContaining({ resource: 'john-doe/skills/typescript-review', harness: 'codex' }),
        expect.objectContaining({ resource: 'jane-doe/agents/api-reviewer', harness: 'codex' }),
        expect.objectContaining({ resource: 'john-doe/skills/typescript-review', harness: 'opencode' }),
        expect.objectContaining({ resource: 'jane-doe/agents/api-reviewer', harness: 'opencode' }),
      ]),
    });

    const update = await app.request('/api/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });

    expect(update.status).toBe(200);
    await expect(update.json()).resolves.toMatchObject({
      updated: false,
      harnesses: request.harnesses,
    });

    const remove = await app.request(
      `/api/installed?resource=${encodeURIComponent(request.resource)}&harnesses=${encodeURIComponent(request.harnesses.join(','))}&scope=project`,
      { method: 'DELETE' },
    );

    expect(remove.status).toBe(200);
    await expect(app.request('/api/installed?scope=project').then((response) => response.json())).resolves.toEqual({
      installations: [],
    });
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ai-directory-server-'));
  temporaryDirectories.push(directory);
  return directory;
}
