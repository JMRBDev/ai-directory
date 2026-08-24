import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resourceKey } from '@ai-directory/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyResourceOperations,
  openCodeInstaller,
  planResourceOperations,
} from '../src/index.js';
import {
  cleanupTemporaryDirectories,
  createTemporaryDirectory,
  resource,
  resourceWithCodexMetadata,
  ruleResource,
  toolResource,
} from './fixtures.js';

afterEach(cleanupTemporaryDirectories);

describe('shared resource operations', () => {
  it('plans, applies, and removes one operation across multiple harnesses', async () => {
    const homeDirectory = await createTemporaryDirectory();
    const operation = {
      resource: resourceKey(resource.resource),
      harnesses: ['claude-code', 'opencode'] as const,
      action: 'install' as const,
      resources: [resource],
      warningResources: [resource],
    };

    const plan = await planResourceOperations([operation], { homeDirectory });
    expect(plan.changes).toHaveLength(4);
    expect(plan.conflicts).toEqual([]);

    const applied = await applyResourceOperations(
      [operation],
      { homeDirectory },
      false,
      plan,
    );
    expect(applied.installed).toHaveLength(2);
    await expect(
      readFile(join(homeDirectory, '.local', 'share', 'ai-directory', 'installed.json.lock'), 'utf8'),
    ).rejects.toThrow();

    const uninstall = await applyResourceOperations(
      [{
        resource: operation.resource,
        harnesses: [...operation.harnesses],
        action: 'uninstall' as const,
        resourceIds: [operation.resource],
      }],
      { homeDirectory },
    );
    expect(uninstall.removed).toHaveLength(2);
  });

  it('blocks an operation while another process owns the install lock', async () => {
    const homeDirectory = await createTemporaryDirectory();
    const lockPath = join(homeDirectory, '.local', 'share', 'ai-directory', 'installed.json.lock');
    await mkdir(join(homeDirectory, '.local', 'share', 'ai-directory'), { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({ pid: process.pid, token: 'test-lock' }),
      'utf8',
    );

    await expect(
      applyResourceOperations(
        [{
          resource: resourceKey(resource.resource),
          harnesses: ['claude-code'],
          action: 'install',
          resources: [resource],
        }],
        { homeDirectory },
      ),
    ).rejects.toThrow('Another AI Directory installation is in progress');
  });

  it('reclaims a lock owned by a dead process', async () => {
    const homeDirectory = await createTemporaryDirectory();
    const lockPath = join(homeDirectory, '.local', 'share', 'ai-directory', 'installed.json.lock');
    await mkdir(join(homeDirectory, '.local', 'share', 'ai-directory'), { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({ pid: Number.MAX_SAFE_INTEGER, token: 'stale-lock' }),
      'utf8',
    );

    await expect(
      applyResourceOperations(
        [{
          resource: resourceKey(resource.resource),
          harnesses: ['claude-code'],
          action: 'install',
          resources: [resource],
        }],
        { homeDirectory },
      ),
    ).resolves.toMatchObject({ installed: [expect.anything()] });
    await expect(readFile(lockPath, 'utf8')).rejects.toThrow();
  });

  it('applies an operation inside the supplied home directory', async () => {
    const homeDirectory = await createTemporaryDirectory();
    const operation = {
      resource: resourceKey(resource.resource),
      harnesses: ['claude-code', 'opencode', 'codex'] as const,
      action: 'install' as const,
      resources: [resourceWithCodexMetadata],
    };

    const applied = await applyResourceOperations(
      [operation],
      {
        homeDirectory,
        environment: { CODEX_HOME: join(homeDirectory, '.codex') },
      },
    );

    expect(applied.installed).toHaveLength(3);
    await expect(
      readFile(
        join(homeDirectory, '.claude', 'skills', 'typescript-api-review', 'SKILL.md'),
        'utf8',
      ),
    ).resolves.toBe('# API review\n');
    await expect(
      readFile(
        join(homeDirectory, '.config', 'opencode', 'skills', 'typescript-api-review', 'SKILL.md'),
        'utf8',
      ),
    ).resolves.toBe('# API review\n');
    await expect(
      readFile(
        join(homeDirectory, '.agents', 'skills', 'typescript-api-review', 'agents', 'openai.yaml'),
        'utf8',
      ),
    ).resolves.toContain('display_name');
    await expect(
      readFile(join(homeDirectory, '.local', 'share', 'ai-directory', 'installed.json'), 'utf8'),
    ).resolves.toContain('jose-rosendo/skills/typescript-api-review');
  });

  it('rejects a stale plan before writing files', async () => {
    const homeDirectory = await createTemporaryDirectory();
    const configPath = join(homeDirectory, '.config', 'opencode', 'opencode.json');
    const operation = {
      resource: resourceKey(ruleResource.resource),
      harnesses: ['claude-code', 'opencode'] as const,
      action: 'install' as const,
      resources: [ruleResource],
      warningResources: [ruleResource],
    };

    await mkdir(join(homeDirectory, '.config', 'opencode'), { recursive: true });
    await writeFile(configPath, '{"instructions": []}\n', 'utf8');
    const plan = await planResourceOperations([operation], { homeDirectory });
    await writeFile(configPath, '{ invalid json\n', 'utf8');

    const failure = applyResourceOperations([operation], { homeDirectory }, false, plan);
    await expect(failure).rejects.toThrow('Change plan is outdated. Generate a new preview before applying.');
    await expect(
      readFile(join(homeDirectory, '.claude', 'rules', 'typescript-quality.md'), 'utf8'),
    ).rejects.toThrow();
    await expect(
      readFile(join(homeDirectory, '.local', 'share', 'ai-directory', 'installed.json'), 'utf8'),
    ).rejects.toThrow();
    await expect(readFile(configPath, 'utf8')).resolves.toBe('{ invalid json\n');
    await expect(
      readFile(join(homeDirectory, '.local', 'share', 'ai-directory', 'installed.json.lock'), 'utf8'),
    ).rejects.toThrow();
  });

  it('rolls back earlier harness changes when a later write fails', async () => {
    const homeDirectory = await createTemporaryDirectory();
    const operation = {
      resource: resourceKey(resource.resource),
      harnesses: ['claude-code', 'opencode'] as const,
      action: 'install' as const,
      resources: [resource],
    };

    const plan = await planResourceOperations([operation], { homeDirectory });
    const failedInstaller = vi
      .spyOn(openCodeInstaller, 'install')
      .mockRejectedValueOnce(new Error('simulated OpenCode failure'));

    try {
      const failure = applyResourceOperations([operation], { homeDirectory }, false, plan);
      await expect(failure).rejects.toThrow('Failed to install jose-rosendo/skills/typescript-api-review');
      await expect(failure).rejects.toThrow('All changes were rolled back');
      await expect(
        readFile(join(homeDirectory, '.claude', 'skills', 'typescript-api-review', 'SKILL.md'), 'utf8'),
      ).rejects.toThrow();
      await expect(
        access(join(homeDirectory, '.claude', 'skills', 'typescript-api-review')),
      ).rejects.toThrow();
      await expect(access(join(homeDirectory, '.claude', 'skills'))).rejects.toThrow();
      await expect(access(join(homeDirectory, '.config', 'opencode'))).rejects.toThrow();
      await expect(
        readFile(join(homeDirectory, '.local', 'share', 'ai-directory', 'installed.json'), 'utf8'),
      ).rejects.toThrow();
      await expect(
        access(join(homeDirectory, '.local', 'share', 'ai-directory')),
      ).rejects.toThrow();
    } finally {
      failedInstaller.mockRestore();
    }
  });

  it('rolls back dependencies when a later harness install fails', async () => {
    const homeDirectory = await createTemporaryDirectory();
    const dependencyResource = {
      ...toolResource,
      files: toolResource.files.map((file) =>
        file.path === 'TOOL.md'
          ? {
              ...file,
              content: file.content.replace(
                '---\n# RTK',
                'runtime:\n  command: rtk\n  installers:\n    - manager: homebrew\n      package: rtk\n---\n# RTK',
              ),
            }
          : file,
      ),
    } satisfies ResourceVersion;
    const operation = {
      resource: resourceKey(dependencyResource.resource),
      harnesses: ['claude-code', 'opencode'] as const,
      action: 'install' as const,
      resources: [dependencyResource],
    };

    const plan = await planResourceOperations([operation], { homeDirectory });
    const installed = new Set<string>();
    const calls: string[] = [];
    const failedInstaller = vi
      .spyOn(openCodeInstaller, 'install')
      .mockRejectedValueOnce(new Error('simulated OpenCode failure'));

    try {
      const failure = applyResourceOperations(
        [operation],
        {
          homeDirectory,
          installDependencies: true,
          dependencyCommandRunner: async (command, args) => {
            calls.push([command, ...args].join(' '));
            if (command === 'rtk' && args[0] === '--version') {
              if (!installed.has('rtk')) throw new Error('rtk is not installed');
              return { stdout: 'rtk 1.0.0', stderr: '' };
            }
            if (command === 'brew' && args[0] === '--version') {
              return { stdout: 'Homebrew 4.0.0', stderr: '' };
            }
            if (command === 'brew' && args.join(' ') === 'install rtk') {
              installed.add('rtk');
              return { stdout: 'Installed rtk', stderr: '' };
            }
            if (command === 'brew' && args.join(' ') === 'uninstall rtk') {
              installed.delete('rtk');
              return { stdout: 'Uninstalled rtk', stderr: '' };
            }
            throw new Error('Unexpected command: ' + command + ' ' + args.join(' '));
          },
        },
        false,
        plan,
      );

      await expect(failure).rejects.toThrow('All changes were rolled back');
      expect(installed).toEqual(new Set());
      expect(calls).toContain('brew uninstall rtk');
      await expect(
        readFile(join(homeDirectory, '.claude', 'skills', 'rtk', 'TOOL.md'), 'utf8'),
      ).rejects.toThrow();
      await expect(
        readFile(join(homeDirectory, '.local', 'share', 'ai-directory', 'installed.json'), 'utf8'),
      ).rejects.toThrow();
    } finally {
      failedInstaller.mockRestore();
    }
  });
});
