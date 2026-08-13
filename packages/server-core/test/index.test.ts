import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getConfigPath, getInstallManifestPath, readConfigFile, writeConfigFile } from '@ai-directory/config';
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

  it('returns the authenticated GitHub username for resource IDs', async () => {
    const app = createApp({
      cwd: await createTemporaryDirectory(),
      commandRunner: async (command, args) => {
        expect([command, ...args]).toEqual(['gh', 'api', 'user', '--jq', '.login']);
        return { stdout: 'JMRBDev\n', stderr: '' };
      },
    });

    const response = await app.request('/api/github-user');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ username: 'jmrbdev' });
  });

  it('validates an uploaded resource without touching Git', async () => {
    const app = createApp({ cwd: await createTemporaryDirectory() });
    const form = resourceForm({
      resourceId: 'jane-doe/skills/web-review',
    });

    const response = await app.request('/api/validate', {
      method: 'POST',
      body: form,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      resource: 'jane-doe/skills/web-review',
      version: '1.0.0',
      description: 'Web review',
      entryFile: 'SKILL.md',
      files: ['SKILL.md'],
    });
  });

  it('submits an uploaded resource through the configured Git registry', async () => {
    const cwd = await createTemporaryDirectory();
    await writeConfigFile(getConfigPath('project', cwd), {
      repository: 'git@example.com:company/registry.git',
    });
    const commands: string[] = [];
    const app = createApp({
      cwd,
      commandRunner: async (command, args) => {
        commands.push(`${command} ${args.join(' ')}`);

        if (command === 'git' && args[0] === 'clone') {
          const destination = args.at(-1);
          if (!destination) throw new Error('Missing clone destination.');
          await writeFile(
            join(destination, 'index.json'),
            JSON.stringify({ schemaVersion: 1, resources: [] }),
            'utf8',
          );
        }

        if (command === 'git' && args[0] === 'branch') return { stdout: 'main\n', stderr: '' };
        if (command === 'git' && args[0] === 'rev-parse') return { stdout: 'abc123\n', stderr: '' };
        if (command === 'gh' && args[0] === 'pr') {
          return { stdout: 'https://github.com/example/registry/pull/42\n', stderr: '' };
        }

        return { stdout: '', stderr: '' };
      },
    });
    const form = resourceForm({
      resourceId: 'jane-doe/skills/web-review',
    });

    const response = await app.request('/api/submit', {
      method: 'POST',
      body: form,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      resource: {
        owner: 'jane-doe',
        type: 'skills',
        name: 'web-review',
        latestVersion: '1.0.0',
        reviewStatus: 'unreviewed',
        description: 'Web review',
      },
      pullRequestUrl: 'https://github.com/example/registry/pull/42',
    });
    expect(commands).toContain('gh auth status');
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

  it('keeps global installations inside the configured home directory', async () => {
    const cwd = await createTemporaryDirectory();
    const homeDirectory = await createTemporaryDirectory();
    const app = createApp({
      cwd,
      homeDirectory,
      environment: { CODEX_HOME: join(homeDirectory, '.codex') },
      registryIndexPath: fixtureIndexPath,
    });

    const resource = 'john-doe/skills/typescript-review';
    const install = await app.request('/api/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resource, harnesses: ['codex'], scope: 'global' }),
    });

    expect(install.status).toBe(200);
    await expect(
      readFile(join(homeDirectory, '.agents', 'skills', 'typescript-review', 'SKILL.md'), 'utf8'),
    ).resolves.toContain('TypeScript');
    await expect(app.request('/api/installed?scope=global').then((response) => response.json())).resolves.toMatchObject({
      installations: [expect.objectContaining({ resource, harness: 'codex', scope: 'global' })],
    });
  });

  it('discovers managed and unmanaged project resources', async () => {
    const cwd = await createTemporaryDirectory();
    const app = createApp({ cwd, registryIndexPath: fixtureIndexPath });

    await mkdir(join(cwd, '.claude', 'skills', 'local-skill'), { recursive: true });
    await writeFile(
      join(cwd, '.claude', 'skills', 'local-skill', 'SKILL.md'),
      '# Local skill\n',
      'utf8',
    );

    const install = await app.request('/api/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        resource: 'john-doe/skills/typescript-review',
        harnesses: ['claude-code'],
        scope: 'project',
      }),
    });
    expect(install.status).toBe(200);

    const response = await app.request('/api/local-resources?scope=project');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      resources: expect.arrayContaining([
        expect.objectContaining({
          resource: 'john-doe/skills/typescript-review',
          harness: 'claude-code',
          scope: 'project',
          state: 'managed',
          registryState: 'current',
          latestVersion: '1.2.0',
        }),
        expect.objectContaining({
          type: 'skills',
          name: 'local-skill',
          harness: 'claude-code',
          scope: 'project',
          state: 'unmanaged',
        }),
      ]),
    });
  });

  it('previews and applies a batch without mutating during the preview', async () => {
    const cwd = await createTemporaryDirectory();
    const app = createApp({ cwd, registryIndexPath: fixtureIndexPath });
    const request = {
      operations: [{
        resource: 'john-doe/skills/typescript-review',
        action: 'install',
        harnesses: ['claude-code', 'opencode'],
        scope: 'project',
      }],
    };
    const skillPath = join(cwd, '.claude', 'skills', 'typescript-review', 'SKILL.md');

    const plan = await app.request('/api/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });

    expect(plan.status).toBe(200);
    const planned = await plan.json() as { fingerprint: string; changes: Array<{ path: string; action: string }>; conflicts: string[] };
    expect(planned).toMatchObject({
      changes: expect.arrayContaining([
        expect.objectContaining({ path: skillPath, action: 'added' }),
      ]),
      conflicts: [],
    });
    await expect(readFile(skillPath, 'utf8')).rejects.toThrow();

    const applied = await app.request('/api/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...request, planFingerprint: planned.fingerprint }),
    });

    expect(applied.status).toBe(200);
    await expect(readFile(skillPath, 'utf8')).resolves.toContain('TypeScript');
  });

  it('rejects applying a plan after its files change', async () => {
    const cwd = await createTemporaryDirectory();
    const app = createApp({ cwd, registryIndexPath: fixtureIndexPath });
    const request = {
      operations: [{
        resource: 'john-doe/skills/typescript-review',
        action: 'install',
        harnesses: ['claude-code'],
        scope: 'project',
      }],
    };
    const skillPath = join(cwd, '.claude', 'skills', 'typescript-review', 'SKILL.md');

    const plan = await app.request('/api/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    const planned = await plan.json() as { fingerprint: string };
    await mkdir(join(cwd, '.claude', 'skills', 'typescript-review'), { recursive: true });
    await writeFile(skillPath, '# External change\n', 'utf8');

    const applied = await app.request('/api/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...request, planFingerprint: planned.fingerprint }),
    });

    expect(applied.status).toBe(409);
    await expect(applied.json()).resolves.toMatchObject({
      error: 'The change plan is outdated. Generate a new preview before applying.',
    });
    await expect(readFile(skillPath, 'utf8')).resolves.toBe('# External change\n');
  });

  it('previews stale files removed by a newer harness projection', async () => {
    const cwd = await createTemporaryDirectory();
    const app = createApp({ cwd, registryIndexPath: fixtureIndexPath });
    const resourceId = 'john-doe/skills/typescript-review';
    const stalePath = join(cwd, '.claude', 'skills', 'typescript-review', 'agents', 'openai.yaml');

    const install = await app.request('/api/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resource: resourceId, harnesses: ['claude-code'], scope: 'project' }),
    });
    expect(install.status).toBe(200);

    await mkdir(join(cwd, '.claude', 'skills', 'typescript-review', 'agents'), { recursive: true });
    await writeFile(stalePath, 'interface:\n  display_name: "Legacy"\n', 'utf8');
    const manifestPath = getInstallManifestPath('project', cwd);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      installations: Array<{ resource: string; files: string[]; fileHashes: Record<string, string> }>;
    };
    const record = manifest.installations[0];
    if (!record) throw new Error('Expected an installation record.');
    record.files.push(stalePath);
    record.fileHashes[stalePath] = createHash('sha256').update('interface:\n  display_name: "Legacy"\n').digest('hex');
    await writeFile(manifestPath, JSON.stringify({ schemaVersion: 1, installations: manifest.installations }), 'utf8');

    const plan = await app.request('/api/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operations: [{ resource: resourceId, action: 'install', harnesses: ['claude-code'], scope: 'project' }],
      }),
    });

    expect(plan.status).toBe(200);
    await expect(plan.json()).resolves.toMatchObject({
      changes: expect.arrayContaining([
        expect.objectContaining({ path: stalePath, action: 'removed', resource: resourceId }),
      ]),
    });
    await expect(readFile(stalePath, 'utf8')).resolves.toContain('Legacy');
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

function resourceForm(options: {
  resourceId: string;
  description?: string;
  version?: string;
}): FormData {
  const form = new FormData();
  form.set('resourceId', options.resourceId);
  form.set('version', options.version ?? '1.0.0');
  if (options.description) form.set('description', options.description);
  form.append('files[]', new File(['# Web review\n'], 'SKILL.md', { type: 'text/markdown' }));
  return form;
}
