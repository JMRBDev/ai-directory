import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  installHarness,
  inspectHarness,
  uninstallHarness,
  updateHarness,
  type DependencyCommandResult,
  type HarnessManagementOptions,
} from '../src/index.js';

type Invocation = { command: string; args: string[] };

const temporaryDirectories: string[] = [];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

function createRunner(scenario: {
  claudeVersion?: string;
  codexVersion?: string;
  scriptChannel?: boolean;
  failSelfUpdate?: boolean;
  managedLayout?: boolean;
}) {
  const invocations: Invocation[] = [];
  const root = mkdtempSync(join(tmpdir(), 'aid-harness-'));
  temporaryDirectories.push(root);
  const binaryDirectory = scenario.managedLayout ? join(root, 'bin') : root;
  mkdirSync(binaryDirectory, { recursive: true });
  for (const name of ['claude', 'codex']) {
    writeFileSync(join(binaryDirectory, name), '#!/bin/sh\nexit 0\n');
    chmodSync(join(binaryDirectory, name), 0o755);
  }

  const state = {
    claudeVersion: scenario.claudeVersion,
    codexVersion: scenario.codexVersion,
  };

  async function run(command: string, args: string[]): Promise<DependencyCommandResult> {
    invocations.push({ command, args });
    if (command === 'npm' && args[0] === '--version') return { stdout: '10.9.0', stderr: '' };
    if (command === 'npm' && args[0] === 'prefix') return { stdout: root, stderr: '' };
    if (command === 'bash' && args[0] === '-c' && args[1] === 'command -v curl') {
      if (!scenario.scriptChannel) throw new Error('curl: command not found');
      return { stdout: '/usr/bin/curl', stderr: '' };
    }
    if (command === 'claude' && args[0] === '--version') {
      const version = state.claudeVersion;
      if (!version) throw new Error('command not found: claude');
      return { stdout: `${version} (Claude Code)`, stderr: '' };
    }
    if (command === 'codex' && args[0] === '--version') {
      const version = state.codexVersion;
      if (!version) throw new Error('command not found: codex');
      return { stdout: `codex-cli ${version}`, stderr: '' };
    }
    if (command === 'claude' && args[0] === 'update') {
      if (scenario.failSelfUpdate) throw new Error('self-update is not supported for this installation');
      state.claudeVersion = '2.0.1';
      return { stdout: 'Updated to 2.0.1', stderr: '' };
    }
    if (command === 'bash' && args[0] === '-c' && args[1].includes('claude.ai/install.sh')) {
      state.claudeVersion = '2.0.1';
      return { stdout: 'Installed.', stderr: '' };
    }
    if (command === 'npm' && args[0] === 'install' && args[1] === '--global') {
      state.claudeVersion = '2.0.1';
      state.codexVersion = '2.0.1';
      return { stdout: '', stderr: '' };
    }
    if (command === 'npm' && args[0] === 'uninstall' && args[1] === '--global') {
      state.claudeVersion = undefined;
      state.codexVersion = undefined;
      return { stdout: '', stderr: '' };
    }
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
  }

  const options: HarnessManagementOptions = {
    cwd: root,
    environment: { PATH: binaryDirectory },
    commandRunner: run,
  };

  return { invocations, options };
}

describe('harness management', () => {
  it('installs through the official installer script when available', async () => {
    const fake = createRunner({ scriptChannel: true });
    const result = await installHarness('claude-code', fake.options);

    expect(result).toMatchObject({
      harness: 'claude-code',
      method: 'script',
      command: 'bash',
      version: '2.0.1',
    });
    expect(fake.invocations.some((invocation) => invocation.args.some((arg) => arg.includes('claude.ai/install.sh')))).toBe(true);
    expect(fake.invocations.some((invocation) => invocation.command === 'npm' && invocation.args[0] === 'install')).toBe(false);
  });

  it('falls back to the package manager when the script channel is unavailable', async () => {
    const fake = createRunner({});
    const result = await installHarness('claude-code', fake.options);

    expect(result).toMatchObject({
      harness: 'claude-code',
      method: 'npm',
      manager: 'npm',
      package: '@anthropic-ai/claude-code',
      version: '2.0.1',
    });
  });

  it('refuses to install an already installed harness', async () => {
    const fake = createRunner({ claudeVersion: '1.2.3' });

    await expect(installHarness('claude-code', fake.options))
      .rejects.toThrow('already installed (1.2.3)');
  });

  it('updates an installed harness with its official update command', async () => {
    const fake = createRunner({ claudeVersion: '1.2.3' });
    const result = await updateHarness('claude-code', fake.options);

    expect(result).toMatchObject({
      harness: 'claude-code',
      method: 'self-update',
      command: 'claude',
      args: ['update'],
      version: '2.0.1',
    });

    const status = await inspectHarness('claude-code', fake.options);
    expect(status.upgradeCommand).toBe('claude update');
    expect(status.installCommand).toBe('bash -c curl -fsSL https://claude.ai/install.sh | bash');
  });

  it('falls back to npm on self-update failure only when the binary lives in the npm prefix', async () => {
    const fallbackRunner = createRunner({ claudeVersion: '1.2.3', failSelfUpdate: true, managedLayout: true });
    const result = await updateHarness('claude-code', fallbackRunner.options);

    expect(result).toMatchObject({ harness: 'claude-code', method: 'npm', manager: 'npm', version: '2.0.1' });

    const nativeRunner = createRunner({ claudeVersion: '1.2.3', failSelfUpdate: true });
    await expect(updateHarness('claude-code', nativeRunner.options))
      .rejects.toThrow('not installed through a supported package manager');
  });

  it('updates a harness without an official update command through npm', async () => {
    const fake = createRunner({ codexVersion: '0.151.0', managedLayout: true });
    const result = await updateHarness('codex', fake.options);

    expect(result).toMatchObject({
      harness: 'codex',
      method: 'npm',
      manager: 'npm',
      package: '@openai/codex',
      version: '2.0.1',
    });
    const status = await inspectHarness('codex', fake.options);
    expect(status.upgradeCommand).toBe('npm install --global @openai/codex');
  });

  it('refuses to update a harness whose binary is outside the npm prefix', async () => {
    const fake = createRunner({ codexVersion: '0.151.0' });

    await expect(updateHarness('codex', fake.options))
      .rejects.toThrow('installed outside a supported package manager');
  });

  it('reports the native origin with its binary path', async () => {
    const fake = createRunner({ claudeVersion: '1.2.3' });
    const status = await inspectHarness('claude-code', fake.options);

    expect(status.origin).toBe('native');
    expect(status.originPath).toContain('claude');
  });

  it('reports the npm origin when the binary lives in the npm prefix', async () => {
    const fake = createRunner({ claudeVersion: '1.2.3', managedLayout: true });
    const status = await inspectHarness('claude-code', fake.options);

    expect(status.origin).toBe('npm');
    expect(status.originPath).toContain(join('bin', 'claude'));
  });

  it('uninstalls an npm-owned harness and verifies the removal', async () => {
    const fake = createRunner({ claudeVersion: '1.2.3', managedLayout: true });
    const result = await uninstallHarness('claude-code', fake.options);

    expect(result).toMatchObject({
      harness: 'claude-code',
      method: 'npm',
      manager: 'npm',
      package: '@anthropic-ai/claude-code',
    });
    await expect(inspectHarness('claude-code', fake.options))
      .resolves.toMatchObject({ installed: false });
  });

  it('refuses to uninstall a harness whose binary is outside the npm prefix', async () => {
    const fake = createRunner({ codexVersion: '0.151.0' });

    await expect(uninstallHarness('codex', fake.options))
      .rejects.toThrow('installed outside a supported package manager');
  });

  it('refuses to uninstall a missing harness', async () => {
    const fake = createRunner({});

    await expect(uninstallHarness('claude-code', fake.options))
      .rejects.toThrow('is not installed');
  });
});
