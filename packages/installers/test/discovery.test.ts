import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resourceKey } from '@ai-directory/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createInstallationRecords,
  discoverLocalResources,
  enrichLocalResources,
  installClaudeCodeResources,
  installCodexResources,
  installOpenCodeResources,
} from '../src/index.js';
import {
  cleanupTemporaryDirectories,
  createTemporaryDirectory,
  pluginResource,
  resource,
  toolResource,
} from './fixtures.js';

afterEach(cleanupTemporaryDirectories);


describe('local resource discovery', () => {
  it('finds unmanaged skills, agents, and rules in global harness locations', async () => {
    const homeDirectory = await createTemporaryDirectory();

    await mkdir(join(homeDirectory, '.claude', 'skills', 'local-skill'), { recursive: true });
    await writeFile(
      join(homeDirectory, '.claude', 'skills', 'local-skill', 'SKILL.md'),
      '# Local skill\n',
      'utf8',
    );
    await mkdir(join(homeDirectory, '.config', 'opencode', 'agents'), { recursive: true });
    await writeFile(
      join(homeDirectory, '.config', 'opencode', 'agents', 'local-agent.md'),
      '# Local agent\n',
      'utf8',
    );
    await mkdir(join(homeDirectory, '.ai-directory', 'rules'), { recursive: true });
    await writeFile(
      join(homeDirectory, '.ai-directory', 'rules', 'local-rule.md'),
      '# Local rule\n',
      'utf8',
    );

    const resources = await discoverLocalResources({
      homeDirectory,
      environment: { PATH: '' },
    });

    expect(resources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'skills',
        name: 'local-skill',
        harness: 'claude-code',
        state: 'unmanaged',
      }),
      expect.objectContaining({
        type: 'agents',
        name: 'local-agent',
        harness: 'opencode',
        state: 'unmanaged',
      }),
      expect.objectContaining({
        type: 'rules',
        name: 'local-rule',
        harness: 'codex',
        state: 'unmanaged',
      }),
    ]));
  });

  it('discovers unmanaged plugins and tools in each harness location', async () => {
    const homeDirectory = await createTemporaryDirectory();

    await installClaudeCodeResources([pluginResource, toolResource], { homeDirectory });
    await installOpenCodeResources([pluginResource, toolResource], { homeDirectory });
    await installCodexResources([pluginResource, toolResource], { homeDirectory });

    const resources = await discoverLocalResources({
      homeDirectory,
      environment: { PATH: '' },
    });

    for (const harness of ['claude-code', 'opencode', 'codex'] as const) {
      expect(resources).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'plugins',
          name: 'review-pack',
          harness,
          state: 'unmanaged',
        }),
        expect.objectContaining({
          type: 'tools',
          name: 'rtk',
          harness,
          state: 'unmanaged',
        }),
      ]));
    }
  });

  it('reports managed resources as current, modified, or missing', async () => {
    const homeDirectory = await createTemporaryDirectory();
    const [installation] = await installClaudeCodeResources([resource], {
      homeDirectory,
    });
    const [record] = createInstallationRecords(
      [resource],
      [installation],
      'claude-code',
    );

    await expect(
      discoverLocalResources({ homeDirectory, records: [record] }),
    ).resolves.toEqual([
      expect.objectContaining({
        resource: resourceKey(resource.resource),
        state: 'managed',
        version: '1.0.0',
      }),
    ]);

    await writeFile(join(installation.destination, 'SKILL.md'), '# Changed locally\n', 'utf8');
    await expect(
      discoverLocalResources({ homeDirectory, records: [record] }),
    ).resolves.toEqual([
      expect.objectContaining({ state: 'modified' }),
    ]);

    await rm(installation.destination, { recursive: true, force: true });
    await expect(
      discoverLocalResources({ homeDirectory, records: [record] }),
    ).resolves.toEqual([
      expect.objectContaining({ state: 'missing' }),
    ]);
  });

  it('enriches managed resources with registry freshness', async () => {
    const homeDirectory = await createTemporaryDirectory();
    const [installation] = await installClaudeCodeResources([resource], {
      homeDirectory,
    });
    const [record] = createInstallationRecords(
      [resource],
      [installation],
      'claude-code',
    );
    const discovered = await discoverLocalResources({
      homeDirectory,
      records: [record],
    });

    expect(enrichLocalResources(discovered, {
      schemaVersion: 1,
      resources: [{ ...resource.resource, latestVersion: '1.2.0' }],
    })).toEqual([
      expect.objectContaining({
        registryState: 'outdated',
        latestVersion: '1.2.0',
      }),
    ]);
    expect(enrichLocalResources(discovered, null)).toEqual([
      expect.objectContaining({ registryState: 'unknown' }),
    ]);
  });
});
