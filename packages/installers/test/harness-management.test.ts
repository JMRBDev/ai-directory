import { describe, expect, it } from 'vitest';
import {
  installHarness,
  inspectHarness,
  uninstallHarness,
  updateHarness,
  type DependencyCommandResult,
} from '../src/index.js';

type Invocation = { command: string; args: string[] };

function createRunner(scenario: {
  claudeVersion?: string;
  failManagerCommand?: boolean;
}) {
  const invocations: Invocation[] = [];
  const state = { claudeVersion: scenario.claudeVersion };

  async function run(command: string, args: string[]): Promise<DependencyCommandResult> {
    invocations.push({ command, args });
    if (command === 'npm' && args[0] === '--version') return { stdout: '10.9.0', stderr: '' };
    if (scenario.failManagerCommand && command === 'npm' && args[0] !== '--version') {
      throw new Error('npm exploded');
    }
    if (command === 'claude' && args[0] === '--version') {
      const version = state.claudeVersion;
      if (!version) throw new Error('command not found: claude');
      return { stdout: `${version} (Claude Code)`, stderr: '' };
    }
    if (command === 'npm' && args[0] === 'install' && args[1] === '--global') {
      state.claudeVersion = '2.0.1';
      return { stdout: '', stderr: '' };
    }
    if (command === 'npm' && args[0] === 'uninstall' && args[1] === '--global') {
      state.claudeVersion = undefined;
      return { stdout: '', stderr: '' };
    }
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
  }

  return { invocations, run };
}

const options = { cwd: '/tmp' };

describe('harness management', () => {
  it('installs a missing harness through the package manager and verifies the version', async () => {
    const fake = createRunner({});
    const result = await installHarness('claude-code', { ...options, commandRunner: fake.run });

    expect(result).toMatchObject({
      harness: 'claude-code',
      manager: 'npm',
      package: '@anthropic-ai/claude-code',
      command: 'npm',
      args: ['install', '--global', '@anthropic-ai/claude-code'],
      version: '2.0.1',
    });
    expect(fake.invocations.some((invocation) => invocation.args.includes('--global'))).toBe(true);
  });

  it('refuses to install an already installed harness', async () => {
    const fake = createRunner({ claudeVersion: '1.2.3' });

    await expect(installHarness('claude-code', { ...options, commandRunner: fake.run }))
      .rejects.toThrow('already installed (1.2.3)');
    expect(fake.invocations.some((invocation) => invocation.args.includes('--global'))).toBe(false);
  });

  it('refuses to update a missing harness', async () => {
    const fake = createRunner({});

    await expect(updateHarness('claude-code', { ...options, commandRunner: fake.run }))
      .rejects.toThrow('is not installed');
  });

  it('updates an installed harness in place', async () => {
    const fake = createRunner({ claudeVersion: '1.2.3' });
    const result = await updateHarness('claude-code', { ...options, commandRunner: fake.run });

    expect(result).toMatchObject({ harness: 'claude-code', manager: 'npm', version: '2.0.1' });
    expect(fake.invocations.some((invocation) => invocation.args.includes('--global'))).toBe(true);
  });

  it('uninstalls an installed harness and verifies the removal', async () => {
    const fake = createRunner({ claudeVersion: '1.2.3' });
    const result = await uninstallHarness('claude-code', { ...options, commandRunner: fake.run });

    expect(result).toMatchObject({
      harness: 'claude-code',
      manager: 'npm',
      package: '@anthropic-ai/claude-code',
    });
    await expect(inspectHarness('claude-code', { ...options, commandRunner: fake.run }))
      .resolves.toMatchObject({ installed: false });
  });

  it('reports a failed removal when the binary is still available', async () => {
    const fake = createRunner({ claudeVersion: '1.2.3' });
    const originalRun = fake.run.bind(fake);
    const stubborn = async (command: string, args: string[]): Promise<DependencyCommandResult> => {
      if (command === 'npm' && args[0] === 'uninstall') return { stdout: '', stderr: '' };
      return originalRun(command, args);
    };

    await expect(uninstallHarness('claude-code', { ...options, commandRunner: stubborn }))
      .rejects.toThrow('still available');
  });

  it('continues after a manager command failure and reports the attempt', async () => {
    const fake = createRunner({ claudeVersion: '1.2.3', failManagerCommand: true });

    await expect(uninstallHarness('claude-code', { ...options, commandRunner: fake.run }))
      .rejects.toThrow('npm exploded');
  });

  it('refuses to uninstall a missing harness', async () => {
    const fake = createRunner({});

    await expect(uninstallHarness('claude-code', { ...options, commandRunner: fake.run }))
      .rejects.toThrow('is not installed');
  });
});
