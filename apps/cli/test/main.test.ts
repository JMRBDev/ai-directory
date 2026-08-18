import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, mkdtempSync, writeFileSync } from 'node:fs';
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

function parseManifest(path: string) {
  // SAFETY: The install command writes exactly this manifest shape to disk.
  return JSON.parse(readFileSync(path, 'utf8')) as {
    installations: Array<{ resource: string; harness: string }>;
  };
}

function runAid(
  args: string[],
  cwd = packageRoot,
  index = registryIndex,
  homeDirectory?: string,
): CommandResult {
  const environment = { ...process.env, AI_DIRECTORY_REGISTRY_INDEX: index };
  delete environment.AI_DIRECTORY_REGISTRY_REPOSITORY;
  delete environment.CLAUDE_CONFIG_DIR;
  delete environment.CODEX_HOME;
  delete environment.OPENCODE_CONFIG;
  delete environment.OPENCODE_CONFIG_DIR;
  if (homeDirectory) environment.HOME = homeDirectory;

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
    // SAFETY: The mocked runner rejects with a Node error carrying these fields.
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

  it('discovers local resources in the global setup', () => {
    const home = mkdtempSync(join(tmpdir(), 'ai-directory-cli-home-'));
    const skillDirectory = join(home, '.claude', 'skills', 'local-skill');

    try {
      mkdirSync(skillDirectory, { recursive: true });
      writeFileSync(join(skillDirectory, 'SKILL.md'), '# Local skill\n', 'utf8');

      const result = runAid(['installed'], undefined, registryIndex, home);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('local/skills/local-skill');
      expect(result.stdout).toContain('unmanaged');
      expect(result.stdout).toContain('unknown');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
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

  it('creates a plugin bundle scaffold with a manifest', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ai-directory-cli-plugin-create-'));

    try {
      const result = runAid(
        [
          'create',
          'review-pack',
          '--type',
          'plugins',
          '--owner',
          'jane-doe',
          '--description',
          'A review pack.',
          '--output',
          'bundle',
        ],
        cwd,
      );
      const entry = readFileSync(
        join(cwd, 'bundle', '.claude-plugin', 'plugin.json'),
        'utf8',
      );

      expect(result.code).toBe(0);
      expect(entry).toContain('"name": "review-pack"');
      expect(entry).toContain('"description": "A review pack."');

      const validation = runAid(
        ['validate', 'bundle', '--id', 'jane-doe/plugins/review-pack'],
        cwd,
      );
      expect(validation.code).toBe(0);
      expect(validation.stdout).toContain('Valid: jane-doe/plugins/review-pack@1.0.0');
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
    const home = mkdtempSync(join(tmpdir(), 'ai-directory-cli-home-'));

    try {
      const result = runAid(
        [
          'install',
          'jane-doe/agents/api-reviewer',
          '--harness',
          'codex,opencode',
        ],
        undefined,
        registryIndex,
        home,
      );
      expect(result.code).toBe(0);
      // SAFETY: The install command prints this exact manifest path and shape.
      const tracked = result.stdout.match(/Tracked in: (.+)/)?.[1];
      if (!tracked) throw new Error('The install output did not include a manifest path.');
      const manifest = parseManifest(tracked);

      expect(manifest.installations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            resource: 'jane-doe/agents/api-reviewer',
            harness: 'codex',
          }),
          expect.objectContaining({
            resource: 'jane-doe/agents/api-reviewer',
            harness: 'opencode',
          }),
        ]),
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('updates and uninstalls a template pack by its template ID', () => {
    const home = mkdtempSync(join(tmpdir(), 'ai-directory-cli-template-home-'));
    const resource = 'john-doe/templates/review-pack';
    const harnessArguments = ['--harness', 'codex,opencode'];

    try {
      expect(runAid(['install', resource, ...harnessArguments], undefined, templateIndex, home).code).toBe(0);
      expect(runAid(['update', resource, ...harnessArguments], undefined, templateIndex, home).code).toBe(0);
      expect(runAid(['uninstall', resource, ...harnessArguments], undefined, templateIndex, home).code).toBe(0);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
