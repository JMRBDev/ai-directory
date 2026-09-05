import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname } from 'node:path';
import type { CommandResult, CommandRunner } from './types.js';

const execFileAsync = promisify(execFile);

export async function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<CommandResult> {
  const result = await execFileAsync(command, args, { cwd, encoding: 'utf8' });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export async function executeCommand(
  runner: CommandRunner,
  command: string,
  args: string[],
  cwd: string,
): Promise<CommandResult> {
  try {
    return await runner(command, args, cwd);
  } catch (error) {
    throw new Error(
      `Command failed: ${command} ${args.join(' ')}: ${error instanceof Error ? error.message : error}`,
      { cause: error },
    );
  }
}

export function assertSafeRepositoryUrl(repositoryUrl: string): void {
  const trimmed = repositoryUrl.trim();
  if (!trimmed) throw new Error('Registry repository URL is required.');
  if (trimmed.startsWith('-')) {
    throw new Error(`Unsafe registry repository URL: ${repositoryUrl}`);
  }
}

export async function clonePartialRepository(
  runner: CommandRunner,
  repositoryUrl: string,
  destination: string,
  baseBranch: string,
): Promise<void> {
  assertSafeRepositoryUrl(repositoryUrl);
  await executeCommand(
    runner,
    'git',
    ['clone', '--filter=blob:none', '--no-checkout', '--branch', baseBranch, '--', repositoryUrl, destination],
    dirname(destination),
  );
  await executeCommand(runner, 'git', ['sparse-checkout', 'init', '--no-cone'], destination);
  await setSparseCheckout(runner, destination, ['index.json']);
  await executeCommand(runner, 'git', ['checkout', baseBranch], destination);
}

export async function setSparseCheckout(
  runner: CommandRunner,
  destination: string,
  patterns: string[],
): Promise<void> {
  await executeCommand(runner, 'git', ['sparse-checkout', 'set', ...patterns], destination);
}
