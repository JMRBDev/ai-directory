import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type DependencyCommandResult = {
  stdout: string;
  stderr: string;
};

export type DependencyCommandRunner = (
  command: string,
  args: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
) => Promise<DependencyCommandResult>;

export type ToolDependencyOptions = {
  cwd?: string;
  environment?: NodeJS.ProcessEnv;
  commandRunner?: DependencyCommandRunner;
};

export function runnerContext(options: ToolDependencyOptions): {
  cwd: string;
  environment: NodeJS.ProcessEnv;
  runner: DependencyCommandRunner;
} {
  return {
    cwd: options.cwd ?? process.cwd(),
    environment: { ...process.env, ...options.environment },
    runner: options.commandRunner ?? defaultCommandRunner,
  };
}

export async function defaultCommandRunner(
  command: string,
  args: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
): Promise<DependencyCommandResult> {
  const result = await execFileAsync(command, args, {
    cwd,
    env: environment,
    encoding: 'utf8',
    maxBuffer: 1_000_000,
  });

  return {
    stdout: String(result.stdout),
    stderr: String(result.stderr),
  };
}

export function commandErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : String(error);
}

export function versionOutputText(result: DependencyCommandResult): string {
  return (result.stdout + '\n' + result.stderr).trim();
}
