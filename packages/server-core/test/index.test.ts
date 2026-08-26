import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
const fixtureRoot = fileURLToPath(
  new URL('../../registry/test/fixtures/', import.meta.url),
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
    const homeDirectory = await createTemporaryDirectory();
    const app = createApp({ cwd, homeDirectory, registryIndexPath: fixtureIndexPath });
    const request = {
      resource: 'john-doe/skills/typescript-review',
      harnesses: ['claude-code', 'opencode'],
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

    const skillPath = join(homeDirectory, '.claude', 'skills', 'typescript-review', 'SKILL.md');
    const openCodeSkillPath = join(homeDirectory, '.config', 'opencode', 'skills', 'typescript-review', 'SKILL.md');
    await expect(readFile(skillPath, 'utf8')).resolves.toContain('TypeScript');
    await expect(readFile(openCodeSkillPath, 'utf8')).resolves.toContain('TypeScript');

    const listed = await app.request('/api/installed');
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      installations: request.harnesses.map((harness) =>
        expect.objectContaining({ resource: request.resource, harness }),
      ),
    });

    await writeFile(skillPath, '# Local edit\n', 'utf8');
    const blocked = await app.request(
      `/api/installed?resource=${encodeURIComponent(request.resource)}&harnesses=${encodeURIComponent(request.harnesses.join(','))}`,
      { method: 'DELETE' },
    );
    expect(blocked.status).toBe(400);
    await expect(readFile(skillPath, 'utf8')).resolves.toBe('# Local edit\n');
    await expect(readFile(openCodeSkillPath, 'utf8')).resolves.toContain('TypeScript');

    const forced = await app.request(
      `/api/installed?resource=${encodeURIComponent(request.resource)}&harnesses=${encodeURIComponent(request.harnesses.join(','))}&force=true`,
      { method: 'DELETE' },
    );
    expect(forced.status).toBe(200);
    await expect(readFile(skillPath, 'utf8')).rejects.toThrow();
    await expect(readFile(openCodeSkillPath, 'utf8')).rejects.toThrow();

    await expect(app.request('/api/installed').then((response) => response.json())).resolves.toEqual({
      installations: [],
    });
  });

  it('keeps installations inside the configured home directory', async () => {
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
      body: JSON.stringify({ resource, harnesses: ['codex'] }),
    });

    expect(install.status).toBe(200);
    await expect(
      readFile(join(homeDirectory, '.agents', 'skills', 'typescript-review', 'SKILL.md'), 'utf8'),
    ).resolves.toContain('TypeScript');
    await expect(app.request('/api/installed').then((response) => response.json())).resolves.toMatchObject({
      installations: [expect.objectContaining({ resource, harness: 'codex' })],
    });
  });

  it('discovers managed and unmanaged resources in global locations', async () => {
    const cwd = await createTemporaryDirectory();
    const homeDirectory = await createTemporaryDirectory();
    const app = createApp({ cwd, homeDirectory, registryIndexPath: fixtureIndexPath });

    await mkdir(join(homeDirectory, '.claude', 'skills', 'local-skill'), { recursive: true });
    await writeFile(
      join(homeDirectory, '.claude', 'skills', 'local-skill', 'SKILL.md'),
      '# Local skill\n',
      'utf8',
    );

    const install = await app.request('/api/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        resource: 'john-doe/skills/typescript-review',
        harnesses: ['claude-code'],
      }),
    });
    expect(install.status).toBe(200);

    const response = await app.request('/api/local-resources');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      resources: expect.arrayContaining([
        expect.objectContaining({
          resource: 'john-doe/skills/typescript-review',
          harness: 'claude-code',
          state: 'managed',
          registryState: 'current',
          latestVersion: '1.2.0',
        }),
        expect.objectContaining({
          type: 'skills',
          name: 'local-skill',
          harness: 'claude-code',
          state: 'unmanaged',
        }),
      ]),
    });
  });

  it('previews and applies a batch without mutating during the preview', async () => {
    const cwd = await createTemporaryDirectory();
    const homeDirectory = await createTemporaryDirectory();
    const app = createApp({ cwd, homeDirectory, registryIndexPath: fixtureIndexPath });
    const request = {
      operations: [{
        resource: 'john-doe/skills/typescript-review',
        action: 'install',
        harnesses: ['claude-code', 'opencode'],
      }],
    };
    const skillPath = join(homeDirectory, '.claude', 'skills', 'typescript-review', 'SKILL.md');

    const plan = await app.request('/api/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });

    expect(plan.status).toBe(200);
    // SAFETY: The plan endpoint is contract-tested and returns this exact shape.
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

  it('installs tool dependencies before applying a requested change batch', async () => {
    const cwd = await createTemporaryDirectory();
    const homeDirectory = await createTemporaryDirectory();
    const registryDirectory = await createTemporaryDirectory();
    const indexPath = join(registryDirectory, 'index.json');
    const resourceDirectory = join(
      registryDirectory,
      'resources/jose-rosendo/tools/semgrep/1.0.0',
    );
    await mkdir(resourceDirectory, { recursive: true });
    await writeFile(
      indexPath,
      JSON.stringify({
        schemaVersion: 1,
        resources: [{
          owner: 'jose-rosendo',
          type: 'tools',
          name: 'semgrep',
          description: 'Find security patterns.',
          latestVersion: '1.0.0',
          reviewStatus: 'reviewed',
          lifecycleStatus: 'active',
          visibility: 'public',
          updatedAt: '2026-08-19T10:00:00Z',
        }],
      }),
      'utf8',
    );
    await writeFile(
      join(resourceDirectory, 'TOOL.md'),
      [
        '---',
        'name: semgrep',
        'description: Find security patterns.',
        'command: semgrep',
        'runtime:',
        '  command: semgrep',
        '  minimumVersion: 1.0.0',
        '  installers:',
        '    - manager: homebrew',
        '      package: semgrep',
        '---',
        '# Semgrep',
        '',
      ].join('\n'),
      'utf8',
    );
    await mkdir(join(resourceDirectory, '.opencode/tools'), { recursive: true });
    await writeFile(join(resourceDirectory, '.opencode/tools/semgrep.ts'), 'export default {}\n', 'utf8');

    let installed = false;
    const calls: string[] = [];
    const app = createApp({
      cwd,
      homeDirectory,
      registryIndexPath: indexPath,
      dependencyCommandRunner: async (command, args) => {
        calls.push([command, ...args].join(' '));
        if (command === 'semgrep' && args[0] === '--version') {
          if (!installed) throw new Error('semgrep is not installed');
          return { stdout: 'semgrep 1.8.0', stderr: '' };
        }
        if (command === 'brew' && args[0] === '--version') {
          return { stdout: 'Homebrew 4.0.0', stderr: '' };
        }
        if (command === 'brew' && args.join(' ') === 'install semgrep') {
          installed = true;
          return { stdout: 'Installed semgrep', stderr: '' };
        }
        if (command === 'brew' && args.join(' ') === 'uninstall semgrep') {
          installed = false;
          return { stdout: 'Uninstalled semgrep', stderr: '' };
        }
        throw new Error('Unexpected command: ' + command + ' ' + args.join(' '));
      },
    });
    const operations = [{
      resource: 'jose-rosendo/tools/semgrep',
      action: 'install' as const,
      harnesses: ['opencode' as const],
    }];

    const plan = await app.request('/api/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operations }),
    });
    expect(plan.status).toBe(200);
    // SAFETY: The plan endpoint is contract-tested and returns a fingerprint on success.
    const planned = await plan.json() as { fingerprint: string };

    const applied = await app.request('/api/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operations,
        installDependencies: true,
        planFingerprint: planned.fingerprint,
      }),
    });

    expect(applied.status).toBe(200);
    await expect(applied.json()).resolves.toMatchObject({
      dependencies: [{ status: { ready: true, version: '1.8.0' } }],
    });
    expect(calls).toContain('brew install semgrep');
    await expect(
      readFile(join(homeDirectory, '.config/opencode/tools/semgrep/semgrep.ts'), 'utf8'),
    ).resolves.toContain('export default');
    await expect(readFile(getInstallManifestPath(homeDirectory), 'utf8')).resolves.toContain('"command": "semgrep"');

    const secondInstallOperations = [{
      resource: 'jose-rosendo/tools/semgrep',
      action: 'install' as const,
      harnesses: ['codex' as const],
    }];
    const secondInstallPlan = await app.request('/api/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operations: secondInstallOperations }),
    });
    expect(secondInstallPlan.status).toBe(200);
    // SAFETY: The plan endpoint is contract-tested and returns a fingerprint on success.
    const plannedSecondInstall = await secondInstallPlan.json() as { fingerprint: string };
    const secondInstall = await app.request('/api/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operations: secondInstallOperations,
        installDependencies: true,
        planFingerprint: plannedSecondInstall.fingerprint,
      }),
    });
    expect(secondInstall.status).toBe(200);

    const uninstallOperations = [{
      resource: 'jose-rosendo/tools/semgrep',
      action: 'uninstall' as const,
      harnesses: ['opencode' as const],
      resourceIds: ['jose-rosendo/tools/semgrep'],
    }];
    const uninstallPlan = await app.request('/api/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operations: uninstallOperations }),
    });
    expect(uninstallPlan.status).toBe(200);
    // SAFETY: The plan endpoint is contract-tested and returns a fingerprint and dependency candidates on success.
    const plannedUninstall = await uninstallPlan.json() as {
      fingerprint: string;
      dependencyRemovals: Array<{ command: string }>;
    };
    expect(plannedUninstall.dependencyRemovals).toEqual([]);

    const uninstalled = await app.request('/api/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operations: uninstallOperations,
        removeDependencies: true,
        planFingerprint: plannedUninstall.fingerprint,
      }),
    });
    expect(uninstalled.status).toBe(200);
    await expect(uninstalled.json()).resolves.toMatchObject({
      removedDependencies: [],
    });
    expect(calls).not.toContain('brew uninstall semgrep');
    await expect(
      readFile(join(homeDirectory, '.config/opencode/tools/semgrep/semgrep.ts'), 'utf8'),
    ).rejects.toThrow();
    await expect(readFile(getInstallManifestPath(homeDirectory), 'utf8')).resolves.toContain('"command": "semgrep"');

    const finalUninstallOperations = [{
      ...uninstallOperations[0],
      harnesses: ['codex' as const],
    }];
    const finalUninstallPlan = await app.request('/api/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operations: finalUninstallOperations }),
    });
    expect(finalUninstallPlan.status).toBe(200);
    // SAFETY: The plan endpoint is contract-tested and returns a fingerprint and dependency candidates on success.
    const plannedFinalUninstall = await finalUninstallPlan.json() as {
      fingerprint: string;
      dependencyRemovals: Array<{ command: string }>;
    };
    expect(plannedFinalUninstall.dependencyRemovals).toEqual([
      expect.objectContaining({ command: 'semgrep', uninstallCommand: 'brew uninstall semgrep' }),
    ]);
    const finalUninstalled = await app.request('/api/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operations: finalUninstallOperations,
        removeDependencies: true,
        planFingerprint: plannedFinalUninstall.fingerprint,
      }),
    });
    expect(finalUninstalled.status).toBe(200);
    await expect(finalUninstalled.json()).resolves.toMatchObject({
      removedDependencies: [{ candidate: { command: 'semgrep' } }],
    });
    expect(calls).toContain('brew uninstall semgrep');
    await expect(readFile(getInstallManifestPath(homeDirectory), 'utf8')).resolves.not.toContain('"command": "semgrep"');
  });

  it('rejects applying a plan after its files change', async () => {
    const cwd = await createTemporaryDirectory();
    const homeDirectory = await createTemporaryDirectory();
    const app = createApp({ cwd, homeDirectory, registryIndexPath: fixtureIndexPath });
    const request = {
      operations: [{
        resource: 'john-doe/skills/typescript-review',
        action: 'install',
        harnesses: ['claude-code'],
      }],
    };
    const skillPath = join(homeDirectory, '.claude', 'skills', 'typescript-review', 'SKILL.md');

    const plan = await app.request('/api/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    // SAFETY: The plan endpoint is contract-tested and returns this exact shape.
    const planned = await plan.json() as { fingerprint: string };
    await mkdir(join(homeDirectory, '.claude', 'skills', 'typescript-review'), { recursive: true });
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
    const homeDirectory = await createTemporaryDirectory();
    const app = createApp({ cwd, homeDirectory, registryIndexPath: fixtureIndexPath });
    const resourceId = 'john-doe/skills/typescript-review';
    const stalePath = join(homeDirectory, '.claude', 'skills', 'typescript-review', 'agents', 'openai.yaml');

    const install = await app.request('/api/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resource: resourceId, harnesses: ['claude-code'] }),
    });
    expect(install.status).toBe(200);

    await mkdir(join(homeDirectory, '.claude', 'skills', 'typescript-review', 'agents'), { recursive: true });
    await writeFile(stalePath, 'interface:\n  display_name: "Legacy"\n', 'utf8');
    const manifestPath = getInstallManifestPath(homeDirectory);
    // SAFETY: The apply endpoint writes the manifest to disk; the written file matches the contract.
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
        operations: [{ resource: resourceId, action: 'install', harnesses: ['claude-code'] }],
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
    const homeDirectory = await createTemporaryDirectory();
    const registryDirectory = await createTemporaryDirectory();
    await cp(fixtureRoot, registryDirectory, { recursive: true });
    const copiedTemplateIndexPath = join(registryDirectory, 'template-index.json');
    const app = createApp({ cwd, homeDirectory, registryIndexPath: copiedTemplateIndexPath });
    const request = {
      resource: 'john-doe/templates/review-pack',
      harnesses: ['codex', 'opencode'],
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

    const templatePath = join(
      registryDirectory,
      'resources/john-doe/templates/review-pack/1.0.0/TEMPLATE.md',
    );
    const template = await readFile(templatePath, 'utf8');
    await writeFile(
      templatePath,
      template.replace('  - id: jane-doe/agents/api-reviewer\n    version: 0.3.0\n', ''),
      'utf8',
    );

    const remove = await app.request(
      `/api/installed?resource=${encodeURIComponent(request.resource)}&harnesses=${encodeURIComponent(request.harnesses.join(','))}`,
      { method: 'DELETE' },
    );

    expect(remove.status).toBe(200);
    await expect(app.request('/api/installed').then((response) => response.json())).resolves.toEqual({
      installations: [],
    });
    await expect(
      readFile(join(homeDirectory, '.agents', 'skills', 'typescript-review', 'SKILL.md'), 'utf8'),
    ).rejects.toThrow();
    await expect(
      readFile(join(homeDirectory, '.codex', 'agents', 'api-reviewer.toml'), 'utf8'),
    ).rejects.toThrow();
  });

  it('updates a file resource to a requested version', async () => {
    const cwd = await createTemporaryDirectory();
    const homeDirectory = await createTemporaryDirectory();
    const app = createApp({ cwd, homeDirectory, registryIndexPath: fixtureIndexPath });
    const request = { resource: 'john-doe/skills/typescript-review', harnesses: ['claude-code'] };
    const skillPath = join(homeDirectory, '.claude', 'skills', 'typescript-review', 'SKILL.md');

    const install = await app.request('/api/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...request, version: '1.1.0' }),
    });

    expect(install.status).toBe(200);
    await expect(install.json()).resolves.toMatchObject({
      resource: { version: '1.1.0' },
      records: [expect.objectContaining({ resource: request.resource, harness: 'claude-code', version: '1.1.0' })],
    });
    await expect(readFile(skillPath, 'utf8')).resolves.toContain('Review TypeScript changes for correctness.');

    const current = await app.request('/api/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...request, version: '1.1.0' }),
    });

    expect(current.status).toBe(200);
    await expect(current.json()).resolves.toMatchObject({
      updated: false,
      harnesses: request.harnesses,
    });

    const update = await app.request('/api/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...request, version: '1.2.0' }),
    });

    expect(update.status).toBe(200);
    await expect(update.json()).resolves.toMatchObject({
      updated: true,
      harnesses: request.harnesses,
      records: [expect.objectContaining({ resource: request.resource, harness: 'claude-code', version: '1.2.0' })],
    });
    await expect(readFile(skillPath, 'utf8')).resolves.toContain('error handling, and tests');
  });

  it('reports harness detection and management status for the local machine', async () => {
    const cwd = await createTemporaryDirectory();
    const homeDirectory = await createTemporaryDirectory();
    const app = createApp({
      cwd,
      homeDirectory,
      environment: {
        CLAUDE_CONFIG_DIR: join(homeDirectory, '.claude'),
        CODEX_HOME: join(homeDirectory, '.codex'),
        OPENCODE_CONFIG_DIR: join(homeDirectory, '.config', 'opencode'),
        XDG_CONFIG_HOME: join(homeDirectory, '.config'),
      },
      dependencyCommandRunner: async (command) => {
        if (command === 'npm') return { stdout: '10.0.0', stderr: '' };
        throw new Error(`command not found: ${command}`);
      },
    });

    const response = await app.request('/api/harnesses');
    expect(response.status).toBe(200);
    // SAFETY: The harnesses endpoint merges the detection and management contracts.
    const body = await response.json() as {
      harnesses: Array<{ harness: string; configured: boolean; installed: boolean; installCommand: string; version?: string }>;
    };
    expect(body.harnesses.map((harness) => harness.harness)).toEqual(['claude-code', 'opencode', 'codex']);
    for (const harness of body.harnesses) {
      expect(harness.configured).toBe(false);
      expect(harness.installed).toBe(false);
      expect(harness.installCommand).toContain('npm install --global');
      expect(harness.version).toBeUndefined();
    }
  });

  it('installs and uninstalls a harness through package-manager commands', async () => {
    const cwd = await createTemporaryDirectory();
    const homeDirectory = await createTemporaryDirectory();
    let claudeVersion: string | undefined;
    const runnerCalls: string[] = [];
    const app = createApp({
      cwd,
      homeDirectory,
      dependencyCommandRunner: async (command, args) => {
        runnerCalls.push([command, ...args].join(' '));
        if (command === 'npm' && args[0] === '--version') return { stdout: '10.0.0', stderr: '' };
        if (command === 'claude' && args[0] === '--version') {
          if (!claudeVersion) throw new Error('command not found: claude');
          return { stdout: `v${claudeVersion}`, stderr: '' };
        }
        if (command === 'npm' && args[0] === 'install') {
          claudeVersion = '2.0.1';
          return { stdout: '', stderr: '' };
        }
        if (command === 'npm' && args[0] === 'uninstall') {
          claudeVersion = undefined;
          return { stdout: '', stderr: '' };
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    });
    const request = { method: 'POST', headers: { 'content-type': 'application/json' } } as const;

    const invalid = await app.request('/api/harnesses/install', {
      ...request,
      body: JSON.stringify({ harness: 'not-a-harness' }),
    });
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({
      error: 'harness must be one of claude-code, opencode, or codex.',
    });

    const install = await app.request('/api/harnesses/install', {
      ...request,
      body: JSON.stringify({ harness: 'claude-code' }),
    });
    expect(install.status).toBe(200);
    await expect(install.json()).resolves.toMatchObject({
      result: {
        harness: 'claude-code',
        manager: 'npm',
        package: '@anthropic-ai/claude-code',
        version: '2.0.1',
      },
    });

    const update = await app.request('/api/harnesses/update', {
      ...request,
      body: JSON.stringify({ harness: 'claude-code' }),
    });
    expect(update.status).toBe(200);
    await expect(update.json()).resolves.toMatchObject({ result: { harness: 'claude-code', version: '2.0.1' } });

    const uninstall = await app.request('/api/harnesses/uninstall', {
      ...request,
      body: JSON.stringify({ harness: 'claude-code' }),
    });
    expect(uninstall.status).toBe(200);
    await expect(uninstall.json()).resolves.toMatchObject({ result: { harness: 'claude-code' } });
    expect(runnerCalls.some((call) => call.startsWith('npm install --global'))).toBe(true);
    expect(runnerCalls.some((call) => call.startsWith('npm uninstall --global'))).toBe(true);
  });

  it('rejects project scope for file resources', async () => {
    const cwd = await createTemporaryDirectory();
    const homeDirectory = await createTemporaryDirectory();
    const app = createApp({ cwd, homeDirectory, registryIndexPath: fixtureIndexPath });
    const errorMessage = { error: 'Project scope is only supported for MCP servers.' };

    const install = await app.request('/api/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        resource: 'john-doe/skills/typescript-review',
        harnesses: ['claude-code'],
        scope: 'project',
      }),
    });

    expect(install.status).toBe(400);
    await expect(install.json()).resolves.toEqual(errorMessage);

    const plan = await app.request('/api/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operations: [{
          resource: 'john-doe/skills/typescript-review',
          action: 'install',
          harnesses: ['claude-code'],
          scope: 'project',
        }],
      }),
    });

    expect(plan.status).toBe(400);
    await expect(plan.json()).resolves.toEqual(errorMessage);
  });

  it('installs and manages an MCP server at project scope', async () => {
    const cwd = await createTemporaryDirectory();
    const homeDirectory = await createTemporaryDirectory();
    const mcpIndexPath = fileURLToPath(
      new URL('../../registry/test/fixtures/mcp-index.json', import.meta.url),
    );
    const app = createApp({ cwd, homeDirectory, registryIndexPath: mcpIndexPath });
    const resource = 'john-doe/mcp-servers/github';

    const install = await app.request('/api/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resource, harnesses: ['opencode'], scope: 'project' }),
    });

    expect(install.status).toBe(200);
    await expect(install.json()).resolves.toMatchObject({
      resource: { resource: { type: 'mcp-servers' } },
      harnesses: ['opencode'],
      records: [expect.objectContaining({ resource, harness: 'opencode', kind: 'mcp', scope: 'project' })],
    });

    const openCodePath = join(cwd, 'opencode.json');
    await expect(readFile(openCodePath, 'utf8')).resolves.toContain('"Authorization": "Bearer {env:GITHUB_PAT}"');
    await expect(readFile(join(cwd, '.ai-directory', 'installed.json'), 'utf8')).resolves.toContain('mcp-servers');

    await expect(app.request('/api/installed').then((response) => response.json())).resolves.toMatchObject({
      installations: [expect.objectContaining({ resource, scope: 'project' })],
    });

    await expect(app.request('/api/local-resources').then((response) => response.json())).resolves.toMatchObject({
      resources: expect.arrayContaining([
        expect.objectContaining({ resource, type: 'mcp-servers', scope: 'project', state: 'managed' }),
      ]),
    });

    const operation = { resource, harnesses: ['opencode'] as const, action: 'uninstall' as const, scope: 'project' as const };
    const plan = await app.request('/api/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operations: [operation] }),
    });
    expect(plan.status).toBe(200);
    await expect(plan.json()).resolves.toMatchObject({
      changes: [expect.objectContaining({ action: 'removed', harness: 'opencode' })],
    });

    const apply = await app.request('/api/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operations: [operation] }),
    });
    expect(apply.status).toBe(200);

    await expect(readFile(openCodePath, 'utf8')).rejects.toThrow();
    await expect(app.request('/api/installed').then((response) => response.json())).resolves.toEqual({
      installations: [],
    });
  });

  it('re-plans the file group after an MCP apply so the shared manifest does not invalidate it', async () => {
    const cwd = await createTemporaryDirectory();
    const homeDirectory = await createTemporaryDirectory();
    const combinedIndexPath = fileURLToPath(
      new URL('../../registry/test/fixtures/combined-index.json', import.meta.url),
    );
    const app = createApp({ cwd, homeDirectory, registryIndexPath: combinedIndexPath });
    const mcpOperation = { resource: 'john-doe/mcp-servers/github', harnesses: ['opencode'] as const, action: 'install' as const };
    const fileOperation = { resource: 'jane-doe/agents/api-reviewer', harnesses: ['claude-code'] as const, action: 'install' as const };
    const agentPath = join(homeDirectory, '.claude', 'agents', 'api-reviewer.md');

    async function plan(operations: typeof mcpOperation[]) {
      const response = await app.request('/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operations }),
      });
      expect(response.status).toBe(200);
      // SAFETY: /api/plan resolves to a ChangePlan, which carries a fingerprint on every success.
      return (await response.json()) as { fingerprint: string };
    }

    async function apply(operations: typeof mcpOperation[], fingerprint?: string) {
      const payload = { operations, planFingerprint: fingerprint } satisfies {
        operations: typeof mcpOperation[];
        planFingerprint?: string;
      };
      return app.request('/api/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }

    const mcpPlan = await plan([mcpOperation]);
    const filePlan = await plan([fileOperation]);
    expect((await apply([mcpOperation], mcpPlan.fingerprint)).status).toBe(200);

    const staleFileApply = await apply([fileOperation], filePlan.fingerprint);
    expect(staleFileApply.status).toBe(409);
    await expect(staleFileApply.json()).resolves.toMatchObject({
      error: 'The change plan is outdated. Generate a new preview before applying.',
    });

    const freshFilePlan = await plan([fileOperation]);
    expect((await apply([fileOperation], freshFilePlan.fingerprint)).status).toBe(200);
    await expect(readFile(agentPath, 'utf8')).resolves.toContain('API Reviewer');
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
