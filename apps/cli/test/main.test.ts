import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliEntry = join(packageRoot, 'src', 'main.ts');
const registryIndex = join(
  packageRoot,
  '..',
  '..',
  'packages',
  'registry',
  'test',
  'fixtures',
  'index.json',
);
const templateIndex = join(
  packageRoot,
  '..',
  '..',
  'packages',
  'registry',
  'test',
  'fixtures',
  'template-index.json',
);

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

function runAid(args: string[], cwd = packageRoot, index = registryIndex): CommandResult {
  const environment = { ...process.env, AI_DIRECTORY_REGISTRY_INDEX: index };
  delete environment.AI_DIRECTORY_REGISTRY_REPOSITORY;
  delete environment.CLAUDE_CONFIG_DIR;
  delete environment.CODEX_HOME;
  delete environment.OPENCODE_CONFIG;
  delete environment.OPENCODE_CONFIG_DIR;

  try {
    return {
      code: 0,
      stdout: execFileSync('bun', ['run', cliEntry, '--', ...args], {
        cwd,
        env: environment,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
      stderr: '',
    };
  } catch (error) {
    const result = error as NodeJS.ErrnoException & {
      status?: number;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
    };

    return {
      code: result.status ?? 1,
      stdout: result.stdout?.toString() ?? '',
      stderr: result.stderr?.toString() ?? '',
    };
  }
}

describe('CLI', () => {
  it('shows usage instead of prompting without a terminal', () => {
    const result = runAid([]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('USAGE aid');
    expect(result.stdout).not.toContain('No command specified.');
  });

  it('lists resources from the configured local index', () => {
    const result = runAid(['list']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('jane-doe/agents/api-reviewer');
    expect(result.stdout).toContain('john-doe/skills/typescript-review');
  });

  it('reports missing arguments without prompting without a terminal', () => {
    const result = runAid(['install']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Resource ID is required.');
  });

  it('installs one resource for multiple harnesses', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ai-directory-cli-'));

    try {
      const result = runAid(
        [
          'install',
          'jane-doe/agents/api-reviewer',
          '--scope',
          'project',
          '--harness',
          'codex,opencode',
        ],
        cwd,
      );
      const manifest = JSON.parse(
        readFileSync(join(cwd, '.ai-directory', 'installed.json'), 'utf8'),
      ) as { installations: Array<{ resource: string; harness: string; scope: string }> };

      expect(result.code).toBe(0);
      expect(manifest.installations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            resource: 'jane-doe/agents/api-reviewer',
            harness: 'codex',
            scope: 'project',
          }),
          expect.objectContaining({
            resource: 'jane-doe/agents/api-reviewer',
            harness: 'opencode',
            scope: 'project',
          }),
        ]),
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('updates and uninstalls a template pack by its template ID', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ai-directory-cli-template-'));
    const resource = 'john-doe/templates/review-pack';
    const harnessArguments = ['--scope', 'project', '--harness', 'codex,opencode'];

    try {
      expect(runAid(['install', resource, ...harnessArguments], cwd, templateIndex).code).toBe(0);
      expect(runAid(['update', resource, ...harnessArguments], cwd, templateIndex).code).toBe(0);
      expect(runAid(['uninstall', resource, ...harnessArguments], cwd, templateIndex).code).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
