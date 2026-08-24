import { constants } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resourceKey } from '@ai-directory/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import {
  installClaudeCodeResources,
  installCodexResources,
  installOpenCodeResources,
  uninstallInstallation,
} from '../src/index.js';
import {
  cleanupTemporaryDirectories,
  createTemporaryDirectory,
  pluginResource,
  toolResource,
} from './fixtures.js';

afterEach(cleanupTemporaryDirectories);

describe('plugin and tool bundles', () => {
  it('installs a plugin as a Claude Code skills-directory plugin', async () => {
    const homeDirectory = await createTemporaryDirectory();

    const [result] = await installClaudeCodeResources([pluginResource], {
      homeDirectory,
    });

    expect(result.destination).toBe(join(homeDirectory, '.claude', 'skills', 'review-pack'));
    await expect(
      readFile(join(result.destination, '.claude-plugin', 'plugin.json'), 'utf8'),
    ).resolves.toContain('"name":"review-pack"');
    await expect(
      readFile(join(result.destination, 'skills', 'reviewer', 'SKILL.md'), 'utf8'),
    ).resolves.toBe('# Reviewer\n');
  });

  it('installs a tool bundle and preserves its Claude adapter files', async () => {
    const homeDirectory = await createTemporaryDirectory();

    const [result] = await installClaudeCodeResources([toolResource], { homeDirectory });

    expect(result.destination).toBe(join(homeDirectory, '.claude', 'skills', 'rtk'));
    await expect(readFile(join(result.destination, 'TOOL.md'), 'utf8')).resolves.toContain(
      'command: rtk',
    );
    await expect(readFile(join(result.destination, 'bin', 'rtk'), 'utf8')).resolves.toContain(
      'printf "rtk',
    );
    await expect(
      access(join(result.destination, 'bin', 'rtk'), constants.X_OK),
    ).resolves.toBeUndefined();
  });

  it('installs OpenCode tool adapters and support files', async () => {
    const homeDirectory = await createTemporaryDirectory();

    const [result] = await installOpenCodeResources([toolResource], { homeDirectory });

    expect(result.destination).toBe(
      join(homeDirectory, '.config', 'opencode', 'plugins', 'rtk.ts'),
    );
    await expect(
      readFile(join(homeDirectory, '.config', 'opencode', 'tools', 'rtk', 'rtk.ts'), 'utf8'),
    ).resolves.toBe('export const tool = {}\n');
    await expect(
      readFile(
        join(homeDirectory, '.config', 'opencode', 'plugins', 'rtk.files', 'bin', 'rtk'),
        'utf8',
      ),
    ).resolves.toContain('printf "rtk');
  });

  it('rejects an OpenCode tool without an adapter', async () => {
    const homeDirectory = await createTemporaryDirectory();

    await expect(
      installOpenCodeResources([{
        ...toolResource,
        files: toolResource.files.filter((file) => !file.path.startsWith('.opencode/')),
      }], { homeDirectory }),
    ).rejects.toThrow('missing an OpenCode adapter');
  });

  it('installs the OpenCode plugin module into the plugins directory', async () => {
    const homeDirectory = await createTemporaryDirectory();

    const [result] = await installOpenCodeResources([pluginResource], {
      homeDirectory,
    });

    expect(result.destination).toBe(
      join(homeDirectory, '.config', 'opencode', 'plugins', 'review-pack.ts'),
    );
    await expect(readFile(result.destination, 'utf8')).resolves.toBe(
      'export const ReviewPack = async () => ({})\n',
    );
    await expect(
      readFile(
        join(
          homeDirectory,
          '.config',
          'opencode',
          'plugins',
          'review-pack.files',
          '.claude-plugin',
          'plugin.json',
        ),
        'utf8',
      ),
    ).resolves.toContain('review-pack');
    await expect(
      readFile(
        join(
          homeDirectory,
          '.config',
          'opencode',
          'plugins',
          'review-pack.files',
          'skills',
          'reviewer',
          'SKILL.md',
        ),
        'utf8',
      ),
    ).resolves.toBe('# Reviewer\n');
  });

  it('uninstalls all OpenCode plugin support files', async () => {
    const homeDirectory = await createTemporaryDirectory();
    const [result] = await installOpenCodeResources([pluginResource], { homeDirectory });
    const record = {
      resource: resourceKey(pluginResource.resource),
      version: pluginResource.version,
      harness: 'opencode',
      destination: result.destination,
      files: result.ownedPaths,
      fileHashes: result.fileHashes,
      installedAt: new Date().toISOString(),
    } satisfies InstallationRecord;

    await uninstallInstallation(record, { homeDirectory });

    await expect(readFile(result.destination, 'utf8')).rejects.toThrow();
    await expect(
      access(join(homeDirectory, '.config', 'opencode', 'plugins', 'review-pack.files')),
    ).rejects.toThrow();
  });

  it('refuses to install a plugin for OpenCode without a module', async () => {
    const homeDirectory = await createTemporaryDirectory();

    await expect(
      installOpenCodeResources(
        [{
          ...pluginResource,
          files: pluginResource.files.filter(
            (file) => !file.path.startsWith('.opencode/'),
          ),
        }],
        { homeDirectory },
      ),
    ).rejects.toThrow('missing an OpenCode module');
  });

  it('installs a Codex plugin bundle and registers a personal marketplace', async () => {
    const homeDirectory = await createTemporaryDirectory();

    const [result] = await installCodexResources([pluginResource], {
      homeDirectory,
    });

    expect(result.destination).toBe(join(homeDirectory, '.codex', 'plugins', 'review-pack'));
    await expect(
      readFile(join(result.destination, '.claude-plugin', 'plugin.json'), 'utf8'),
    ).resolves.toContain('"name":"review-pack"');
    const marketplace = await readFile(
      join(homeDirectory, '.agents', 'plugins', 'marketplace.json'),
      'utf8',
    );
    expect(marketplace).toContain('"name": "review-pack"');
    expect(marketplace).toContain('../.codex/plugins/review-pack');
  });

  it('rejects a marketplace entry owned by another source', async () => {
    const homeDirectory = await createTemporaryDirectory();
    const marketplaceDirectory = join(homeDirectory, '.agents', 'plugins');
    await mkdir(marketplaceDirectory, { recursive: true });
    await writeFile(
      join(marketplaceDirectory, 'marketplace.json'),
      JSON.stringify({
        name: 'external',
        plugins: [{
          name: 'review-pack',
          source: { source: 'github', path: 'owner/review-pack' },
          policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
          category: 'External',
        }],
      }),
      'utf8',
    );

    await expect(
      installCodexResources([pluginResource], { homeDirectory, force: true }),
    ).rejects.toThrow('already used by another source');
  });

  it('rejects plugin and tool marketplace names that overlap', async () => {
    const homeDirectory = await createTemporaryDirectory();
    const collidingTool = {
      ...toolResource,
      resource: {
        ...toolResource.resource,
        name: pluginResource.resource.name,
      },
      files: toolResource.files.map((file) => file.path === 'TOOL.md'
        ? { ...file, content: file.content.replace('name: rtk', 'name: review-pack') }
        : file),
    } satisfies ResourceVersion;

    await expect(
      installCodexResources([pluginResource, collidingTool], { homeDirectory, force: true }),
    ).rejects.toThrow('plugin names overlap');
  });

  it('uninstalls a Codex plugin and removes its marketplace entry', async () => {
    const homeDirectory = await createTemporaryDirectory();

    const [result] = await installCodexResources([pluginResource], {
      homeDirectory,
    });
    const record = {
      resource: resourceKey(pluginResource.resource),
      version: pluginResource.version,
      harness: 'codex',
      destination: result.destination,
      files: result.ownedPaths,
      fileHashes: result.fileHashes,
      shared: result.shared,
      installedAt: new Date().toISOString(),
    } satisfies InstallationRecord;

    await uninstallInstallation(record, { homeDirectory });

    await expect(
      readFile(
        join(homeDirectory, '.codex', 'plugins', 'review-pack', '.claude-plugin', 'plugin.json'),
        'utf8',
      ),
    ).rejects.toThrow();
    await expect(
      access(join(homeDirectory, '.codex', 'plugins', 'review-pack')),
    ).rejects.toThrow();
    await expect(
      access(join(homeDirectory, '.codex', 'plugins')),
    ).resolves.toBeUndefined();
    await expect(
      readFile(join(homeDirectory, '.agents', 'plugins', 'marketplace.json'), 'utf8'),
    ).rejects.toThrow();
  });

  it('protects a Codex marketplace entry that was modified after installation', async () => {
    const homeDirectory = await createTemporaryDirectory();
    const [result] = await installCodexResources([pluginResource], { homeDirectory });
    const record = {
      resource: resourceKey(pluginResource.resource),
      version: pluginResource.version,
      harness: 'codex',
      destination: result.destination,
      files: result.ownedPaths,
      fileHashes: result.fileHashes,
      shared: result.shared,
      installedAt: new Date().toISOString(),
    } satisfies InstallationRecord;
    const marketplacePath = join(homeDirectory, '.agents', 'plugins', 'marketplace.json');
    await writeFile(
      marketplacePath,
      (await readFile(marketplacePath, 'utf8')).replace('"AI Directory"', '"Locally changed"'),
      'utf8',
    );

    await expect(uninstallInstallation(record, { homeDirectory })).rejects.toThrow(
      'marketplace entry was modified',
    );
    await expect(readFile(marketplacePath, 'utf8')).resolves.toContain('Locally changed');

    await uninstallInstallation(record, { homeDirectory, force: true });
    await expect(readFile(marketplacePath, 'utf8')).rejects.toThrow();
});
  });
