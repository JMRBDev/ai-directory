import { describe, expect, it } from 'vitest';
import type { ResourceVersion } from '@ai-directory/registry';
import {
  inspectToolDependencies,
  installToolDependencies,
  toolDependencyRemovalCandidates,
  type DependencyCommandRunner,
} from '../src/index.js';

function toolResource(minimumVersion = '1.0.0'): ResourceVersion {
  return {
    resource: {
      owner: 'jose-rosendo',
      type: 'tools',
      name: 'semgrep',
      description: 'Find security patterns.',
      latestVersion: '1.0.0',
      reviewStatus: 'reviewed',
      lifecycleStatus: 'active',
      visibility: 'public',
      updatedAt: '2026-08-19',
    },
    version: '1.0.0',
    files: [{
      path: 'TOOL.md',
      content: [
        '---',
        'name: semgrep',
        'description: Find security patterns.',
        'command: semgrep',
        'runtime:',
        '  command: semgrep',
        '  minimumVersion: ' + minimumVersion,
        '  installers:',
        '    - manager: homebrew',
        '      package: semgrep',
        '    - manager: pipx',
        '      package: semgrep',
        '---',
        '# Semgrep',
        '',
      ].join('\n'),
    }],
  };
}

describe('tool dependency installation', () => {
  it('detects a missing tool and an available package manager', async () => {
    const runner: DependencyCommandRunner = async (command) => {
      if (command === 'brew') return { stdout: 'Homebrew 4.0.0', stderr: '' };
      throw new Error(command + ' is not installed');
    };

    const [status] = await inspectToolDependencies([toolResource()], {
      commandRunner: runner,
    });

    expect(status).toMatchObject({
      resource: 'jose-rosendo/tools/semgrep',
      installed: false,
      ready: false,
      availableInstallers: [{ manager: 'homebrew', package: 'semgrep' }],
      installCommands: ['brew install semgrep', 'pipx install semgrep'],
    });
  });

  it('deduplicates a shared executable and keeps the strictest version requirement', async () => {
    const secondResource = toolResource('2.0.0');
    secondResource.resource = { ...secondResource.resource, name: 'other-tool' };
    const manifestFile = secondResource.files.find((file) => file.path === 'TOOL.md');
    if (!manifestFile) throw new Error('Expected the tool manifest file.');
    manifestFile.content = manifestFile.content.replace('name: semgrep', 'name: other-tool');
    const runner: DependencyCommandRunner = async (command) => {
      if (command === 'semgrep') return { stdout: 'semgrep 1.8.0', stderr: '' };
      if (command === 'brew') return { stdout: 'Homebrew 4.0.0', stderr: '' };
      throw new Error(command + ' is not installed');
    };

    const statuses = await inspectToolDependencies([toolResource(), secondResource], {
      commandRunner: runner,
    });

    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({
      runtime: { command: 'semgrep', minimumVersion: '2.0.0' },
      ready: false,
    });
  });

  it('installs with the first available allowlisted package manager and verifies the tool', async () => {
    let installed = false;
    const calls: string[] = [];
    const runner: DependencyCommandRunner = async (command, args) => {
      calls.push([command, ...args].join(' '));

      if (command === 'semgrep' && args[0] === '--version') {
        if (!installed) throw new Error('semgrep is not installed');
        return { stdout: 'semgrep 1.8.0', stderr: '' };
      }
      if (command === 'brew' && args[0] === '--version') {
        return { stdout: 'Homebrew 4.0.0', stderr: '' };
      }
      if (command === 'pipx') throw new Error('pipx is not installed');
      if (command === 'brew' && args.join(' ') === 'install semgrep') {
        installed = true;
        return { stdout: 'Installed semgrep', stderr: '' };
      }

      throw new Error('Unexpected command: ' + command + ' ' + args.join(' '));
    };

    const [result] = await installToolDependencies([toolResource()], {
      commandRunner: runner,
    });

    expect(result).toMatchObject({
      resource: 'jose-rosendo/tools/semgrep',
      manager: 'homebrew',
      package: 'semgrep',
      command: 'brew',
      args: ['install', 'semgrep'],
      status: { ready: true, version: '1.8.0' },
    });
    expect(calls).toContain('brew install semgrep');
  });

  it('rolls back dependencies installed before a later dependency fails', async () => {
    const secondResource = toolResource();
    secondResource.resource = { ...secondResource.resource, name: 'other-tool' };
    const manifestFile = secondResource.files.find((file) => file.path === 'TOOL.md');
    if (!manifestFile) throw new Error('Expected the tool manifest.');
    manifestFile.content = manifestFile.content
      .replaceAll('semgrep', 'other-tool')
      .replaceAll('homebrew', 'homebrew');

    const installed = new Set<string>();
    const calls: string[] = [];
    const runner: DependencyCommandRunner = async (command, args) => {
      calls.push([command, ...args].join(' '));

      if (command === 'brew' && args[0] === '--version') {
        return { stdout: 'Homebrew 4.0.0', stderr: '' };
      }
      if (command === 'semgrep' || command === 'other-tool') {
        if (!installed.has(command)) throw new Error(command + ' is not installed');
        return { stdout: command + ' 1.8.0', stderr: '' };
      }
      if (command === 'brew' && args[0] === 'install' && args[1] === 'semgrep') {
        installed.add('semgrep');
        return { stdout: 'Installed semgrep', stderr: '' };
      }
      if (command === 'brew' && args[0] === 'install' && args[1] === 'other-tool') {
        throw new Error('simulated package failure');
      }
      if (command === 'brew' && args[0] === 'uninstall' && args[1] === 'semgrep') {
        installed.delete('semgrep');
        return { stdout: 'Uninstalled semgrep', stderr: '' };
      }

      throw new Error('Unexpected command: ' + command + ' ' + args.join(' '));
    };

    await expect(
      installToolDependencies([toolResource(), secondResource], { commandRunner: runner }),
    ).rejects.toThrow('simulated package failure');
    expect(installed).toEqual(new Set());
    expect(calls).toContain('brew uninstall semgrep');
  });

  it('only offers a platform-installed dependency after its last resource reference', () => {
    const records = [
      {
        resource: 'jose-rosendo/tools/semgrep',
        command: 'semgrep',
        manager: 'homebrew' as const,
        package: 'semgrep',
        version: '1.8.0',
        installedAt: '2026-08-19T10:00:00.000Z',
      },
      {
        resource: 'jose-rosendo/tools/security-pack',
        command: 'semgrep',
        manager: 'homebrew' as const,
        package: 'semgrep',
        version: '1.8.0',
        installedAt: '2026-08-19T10:00:00.000Z',
      },
    ];

    expect(toolDependencyRemovalCandidates(records, ['jose-rosendo/tools/semgrep'])).toEqual([]);
    expect(toolDependencyRemovalCandidates(records, [
      'jose-rosendo/tools/semgrep',
      'jose-rosendo/tools/security-pack',
    ])).toEqual([
      expect.objectContaining({
        command: 'semgrep',
        uninstallCommand: 'brew uninstall semgrep',
      }),
    ]);
  });

  it('rejects an installation when the verified version is below the minimum', async () => {
    const runner: DependencyCommandRunner = async (command) => {
      if (command === 'semgrep') return { stdout: 'semgrep 0.9.0', stderr: '' };
      if (command === 'brew') return { stdout: 'Homebrew 4.0.0', stderr: '' };
      throw new Error(command + ' is not installed');
    };

    await expect(
      installToolDependencies([toolResource()], { commandRunner: runner }),
    ).rejects.toThrow('below the required minimum 1.0.0');
  });

  it('reports when no supported package manager is available', async () => {
    const runner: DependencyCommandRunner = async (command) => {
      throw new Error(command + ' is not installed');
    };

    await expect(
      installToolDependencies([toolResource()], { commandRunner: runner }),
    ).rejects.toThrow('no supported package manager is available');
  });
});
