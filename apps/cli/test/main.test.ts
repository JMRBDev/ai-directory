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

  it('creates a skill scaffold', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ai-directory-cli-create-'));

    try {
      const result = runAid(
        [
          'create',
          'my-skill',
          '--type',
          'skills',
          '--owner',
          'jane-doe',
          '--description',
          'Review TypeScript changes.',
          '--output',
          'created',
        ],
        cwd,
      );
      const entry = readFileSync(join(cwd, 'created', 'SKILL.md'), 'utf8');

      expect(result.code).toBe(0);
      expect(entry).toContain('name: my-skill');
      expect(entry).toContain('description: "Review TypeScript changes."');
      expect(entry).toContain('# My Skill');

      const validation = runAid(
        ['validate', 'created', '--id', 'jane-doe/skills/my-skill'],
        cwd,
      );
      expect(validation.code).toBe(0);
      expect(validation.stdout).toContain('Valid: jane-doe/skills/my-skill@1.0.0');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('creates a template scaffold with explicit components', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ai-directory-cli-template-create-'));

    try {
      const result = runAid(
        [
          'create',
          'review-pack',
          '--type',
          'templates',
          '--owner',
          'jane-doe',
          '--description',
          'A review pack.',
          '--resources',
          'john-doe/skills/typescript-review@1.2.0,jane-doe/agents/api-reviewer@0.3.0',
          '--output',
          'pack',
        ],
        cwd,
      );
      const entry = readFileSync(join(cwd, 'pack', 'TEMPLATE.md'), 'utf8');

      expect(result.code).toBe(0);
      expect(entry).toContain('name: review-pack');
      expect(entry).toContain('id: john-doe/skills/typescript-review');
      expect(entry).toContain('version: 1.2.0');
      expect(entry).toContain('id: jane-doe/agents/api-reviewer');
      expect(entry).toContain('version: 0.3.0');

      const validation = runAid(
        ['validate', 'pack', '--id', 'jane-doe/templates/review-pack'],
        cwd,
      );
      expect(validation.code).toBe(0);
      expect(validation.stdout).toContain('Entry file: TEMPLATE.md');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('reports missing arguments without prompting without a terminal', () => {
    const result = runAid(['install']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Resource ID is required.');
  });

  it('validates submit inputs before accessing the registry', () => {
    const result = runAid([
      'submit',
      './missing-resource',
      '--id',
      'invalid-id',
      '--version',
      '1.0.0',
      '--description',
      'A resource.',
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Invalid resource ID: invalid-id');
  });

  it('reports a missing submit directory clearly', () => {
    const result = runAid([
      'submit',
      './missing-resource',
      '--id',
      'jane-doe/skills/missing-resource',
      '--version',
      '1.0.0',
      '--description',
      'A resource.',
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Resource directory not found:');
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
