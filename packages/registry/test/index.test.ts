import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createRegistrySnapshot,
  isResourceVersionOutdated,
  publishResource,
  readMcpServerManifest,
  readPluginManifest,
  readToolManifest,
  readRemoteRegistryIndex,
  readRemoteResource,
  resolveRegistrySource,
  readRegistryIndex,
  readResourceVersion,
  readTemplateManifest,
  readTemplateResources,
  submitResource,
  validateResourceDirectory,
  validateRegistry,
  validateRemoteRegistry,
} from '../src/index.js';

const fixturePath = fileURLToPath(new URL('./fixtures/index.json', import.meta.url));
const invalidIndexPath = fileURLToPath(new URL('./fixtures/invalid-index.json', import.meta.url));
const duplicateIndexPath = fileURLToPath(new URL('./fixtures/duplicate-index.json', import.meta.url));
const templateIndexPath = fileURLToPath(new URL('./fixtures/template-index.json', import.meta.url));
const mcpIndexPath = fileURLToPath(new URL('./fixtures/mcp-index.json', import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('readRegistryIndex', () => {
  it('loads a valid index', async () => {
    const index = await readRegistryIndex(fixturePath);

    expect(index.resources).toHaveLength(3);
  });

  it('reports a missing index clearly', async () => {
    await expect(readRegistryIndex('/missing/registry-index.json')).rejects.toThrow(
      'Registry index not found: /missing/registry-index.json',
    );
  });

  it('prefers an explicit local index over a remote repository', () => {
    expect(
      resolveRegistrySource({
        indexPath: '/tmp/index.json',
        repositoryUrl: 'git@example.com:company/registry.git',
      }),
    ).toEqual({ type: 'local', indexPath: '/tmp/index.json' });
  });

  it('uses the production branch for a remote repository by default', () => {
    expect(resolveRegistrySource({ repositoryUrl: 'git@example.com:company/registry.git' })).toEqual(
      {
        type: 'remote',
        repositoryUrl: 'git@example.com:company/registry.git',
        baseBranch: 'main',
      },
    );
  });

  it('requires an explicit local index or repository', () => {
    expect(() => resolveRegistrySource({})).toThrow(
      'No registry source configured. Run `aid setup` or pass `--index <path>`.',
    );
  });

  it('compares resource versions using semantic versioning', () => {
    expect(isResourceVersionOutdated('1.2.0', '1.10.0')).toBe(true);
    expect(isResourceVersionOutdated('1.10.0', '1.2.0')).toBe(false);
    expect(isResourceVersionOutdated('1.2.0', '1.2.0')).toBe(false);
  });

  it('reads an index from a temporary sparse checkout', async () => {
    const commands: string[] = [];
    let temporaryRepository = '';

    const index = await readRemoteRegistryIndex({
      repositoryUrl: 'git@example.com:company/registry.git',
      commandRunner: async (command, args) => {
        commands.push(`${command} ${args.join(' ')}`);

        if (command === 'git' && args[0] === 'clone') {
          const destination = args.at(-1);

          if (!destination) throw new Error('Missing clone destination.');

          temporaryRepository = destination;
          await writeFile(
            join(destination, 'index.json'),
            JSON.stringify({ schemaVersion: 1, resources: [] }),
            'utf8',
          );
        }

        return { stdout: '', stderr: '' };
      },
    });

    expect(index.resources).toEqual([]);
    expect(commands).toContain('git sparse-checkout set index.json');
    await expect(readFile(join(temporaryRepository, 'index.json'), 'utf8')).rejects.toThrow();
  });

  it('reuses one temporary checkout across index and resource reads', async () => {
    const commands: string[] = [];
    let temporaryRepository = '';
    const fixtureDirectory = fileURLToPath(new URL('./fixtures', import.meta.url));
    const snapshot = await createRegistrySnapshot(
      {
        type: 'remote',
        repositoryUrl: 'git@example.com:company/registry.git',
        baseBranch: 'main',
      },
      async (command, args) => {
        commands.push(`${command} ${args.join(' ')}`);

        if (command === 'git' && args[0] === 'clone') {
          const destination = args.at(-1);

          if (!destination) throw new Error('Missing clone destination.');

          temporaryRepository = destination;
          await cp(fixtureDirectory, destination, { recursive: true });
        }

        return { stdout: '', stderr: '' };
      },
    );

    expect((await snapshot.readIndex()).resources).toHaveLength(3);
    expect(
      (await snapshot.readResource('john-doe/skills/typescript-review')).resource.version,
    ).toBe('1.2.0');
    expect(
      (await snapshot.readResource('jane-doe/agents/api-reviewer')).resource.version,
    ).toBe('0.3.0');
    expect(commands.filter((command) => command.startsWith('git clone '))).toHaveLength(1);

    await snapshot.close();
    await expect(readFile(join(temporaryRepository, 'index.json'), 'utf8')).rejects.toThrow();
  });

  it('validates resource packages from a temporary remote checkout', async () => {
    const commands: string[] = [];
    const temporaryRepositories: string[] = [];
    const fixtureDirectory = fileURLToPath(new URL('./fixtures', import.meta.url));

    const result = await validateRemoteRegistry({
      repositoryUrl: 'git@example.com:company/registry.git',
      commandRunner: async (command, args) => {
        commands.push(`${command} ${args.join(' ')}`);

        if (command === 'git' && args[0] === 'clone') {
          const destination = args.at(-1);

          if (!destination) throw new Error('Missing clone destination.');

          temporaryRepositories.push(destination);
          await cp(fixtureDirectory, destination, { recursive: true });
        }

        return { stdout: '', stderr: '' };
      },
    });

    expect(result).toEqual({ resourceCount: 3, issues: [] });
    expect(commands).toContain(
      'git sparse-checkout set index.json resources/jane-doe/agents/api-reviewer/0.3.0',
    );
    await Promise.all(
      temporaryRepositories.map((directory) =>
        expect(readFile(join(directory, 'index.json'), 'utf8')).rejects.toThrow(),
      ),
    );
  });

  it('loads a resource version and nested supporting files', async () => {
    const result = await readResourceVersion(
      fixturePath,
      'john-doe/skills/typescript-review',
    );

    expect(result.version).toBe('1.2.0');
    expect(result.files.map((file) => file.path)).toEqual([
      'SKILL.md',
      'references/checklist.md',
    ]);
  });

  it('reads a resource from a temporary sparse checkout', async () => {
    const commands: string[] = [];
    let temporaryRepository = '';

    const result = await readRemoteResource({
      repositoryUrl: 'git@example.com:company/registry.git',
      resourceId: 'john-doe/skills/typescript-review',
      commandRunner: async (command, args) => {
        commands.push(`${command} ${args.join(' ')}`);

        if (command === 'git' && args[0] === 'clone') {
          const destination = args.at(-1);

          if (!destination) throw new Error('Missing clone destination.');

          temporaryRepository = destination;
          await mkdir(
            join(
              destination,
              'resources/john-doe/skills/typescript-review/1.2.0/references',
            ),
            { recursive: true },
          );
          await writeFile(
            join(destination, 'index.json'),
            await readFile(fixturePath, 'utf8'),
            'utf8',
          );
          await writeFile(
            join(
              destination,
              'resources/john-doe/skills/typescript-review/1.2.0/SKILL.md',
            ),
            '# Remote review\n',
            'utf8',
          );
          await writeFile(
            join(
              destination,
              'resources/john-doe/skills/typescript-review/1.2.0/references/checklist.md',
            ),
            '- Check the API\n',
            'utf8',
          );
        }

        return { stdout: '', stderr: '' };
      },
    });

    expect(result.resource.version).toBe('1.2.0');
    expect(result.resources).toHaveLength(1);
    expect(result.resource.files.map((file) => file.path)).toEqual([
      'SKILL.md',
      'references/checklist.md',
    ]);
    expect(commands.slice(0, 5)).toEqual([
      'git clone --filter=blob:none --no-checkout --branch main git@example.com:company/registry.git ' +
        temporaryRepository,
      'git sparse-checkout init --no-cone',
      'git sparse-checkout set index.json',
      'git checkout main',
      'git sparse-checkout set index.json resources/john-doe/skills/typescript-review/1.2.0',
    ]);
    await expect(readFile(join(temporaryRepository, 'index.json'), 'utf8')).rejects.toThrow();
  });

  it('fetches template dependencies in the same temporary checkout', async () => {
    let temporaryRepository = '';

    const result = await readRemoteResource({
      repositoryUrl: 'git@example.com:company/registry.git',
      resourceId: 'john-doe/templates/review-pack',
      commandRunner: async (command, args) => {
        if (command === 'git' && args[0] === 'clone') {
          const destination = args.at(-1);

          if (!destination) throw new Error('Missing clone destination.');

          temporaryRepository = destination;
          await mkdir(join(destination, 'resources/john-doe/templates/review-pack/1.0.0'), {
            recursive: true,
          });
          await mkdir(join(destination, 'resources/john-doe/skills/typescript-review/1.2.0'), {
            recursive: true,
          });
          await mkdir(join(destination, 'resources/jane-doe/agents/api-reviewer/0.3.0'), {
            recursive: true,
          });
          await writeFile(
            join(destination, 'index.json'),
            await readFile(templateIndexPath, 'utf8'),
            'utf8',
          );
          await writeFile(
            join(destination, 'resources/john-doe/templates/review-pack/1.0.0/TEMPLATE.md'),
            await readFile(
              fileURLToPath(
                new URL('./fixtures/resources/john-doe/templates/review-pack/1.0.0/TEMPLATE.md', import.meta.url),
              ),
              'utf8',
            ),
            'utf8',
          );
          await writeFile(
            join(destination, 'resources/john-doe/skills/typescript-review/1.2.0/SKILL.md'),
            '# Remote skill\n',
            'utf8',
          );
          await writeFile(
            join(destination, 'resources/jane-doe/agents/api-reviewer/0.3.0/AGENT.md'),
            '# Remote agent\n',
            'utf8',
          );
        }

        return { stdout: '', stderr: '' };
      },
    });

    expect(result.resource.resource.type).toBe('templates');
    expect(result.resources.map((resource) => resource.resource.type)).toEqual([
      'skills',
      'agents',
    ]);
    await expect(readFile(join(temporaryRepository, 'index.json'), 'utf8')).rejects.toThrow();
  });

  it('loads a template manifest and its referenced resources', async () => {
    const template = await readResourceVersion(
      templateIndexPath,
      'john-doe/templates/review-pack',
    );

    expect(readTemplateManifest(template)).toEqual({
      name: 'review-pack',
      description: 'A review pack for TypeScript API changes.',
      resources: [
        { id: 'john-doe/skills/typescript-review', version: '1.2.0' },
        { id: 'jane-doe/agents/api-reviewer', version: '0.3.0' },
      ],
    });

    const resources = await readTemplateResources(templateIndexPath, template);

    expect(resources.map((resource) => `${resource.resource.owner}/${resource.resource.type}/${resource.resource.name}`)).toEqual([
      'john-doe/skills/typescript-review',
      'jane-doe/agents/api-reviewer',
    ]);
  });

  it('loads an MCP server manifest from the entry file', async () => {
    const server = await readResourceVersion(mcpIndexPath, 'john-doe/mcp-servers/github');

    expect(readMcpServerManifest(server)).toEqual({
      name: 'github',
      description: 'GitHub MCP server for repository workflows.',
      transport: 'http',
      url: 'https://api.githubcopilot.com/mcp/',
      headers: { Authorization: 'Bearer {env:GITHUB_PAT}' },
      env: [{ name: 'GITHUB_PAT', required: true, description: 'GitHub personal access token' }],
    });
  });

  it('reports an unknown resource clearly', async () => {
    await expect(readResourceVersion(fixturePath, 'john-doe/skills/missing')).rejects.toThrow(
      'Resource not found: john-doe/skills/missing',
    );
  });

  it('validates required resource entry files', async () => {
    const result = await validateRegistry(fixturePath);

    expect(result).toEqual({ resourceCount: 3, issues: [] });
  });

  it('reports missing resource packages', async () => {
    const result = await validateRegistry(invalidIndexPath);

    expect(result.issues).toEqual(['Resource version not found: john-doe/skills/missing-package@1.0.0']);
  });

  it('reports duplicate resource IDs', async () => {
    const result = await validateRegistry(duplicateIndexPath);

    expect(result.issues).toContain('Duplicate resource ID: john-doe/skills/typescript-review');
  });
});

describe('validateResourceDirectory', () => {
  it('validates a local template manifest without a registry checkout', async () => {
    const { sourceDirectory } = await createPublishFixture();
    const templateFile = fileURLToPath(
      new URL(
        './fixtures/resources/john-doe/templates/review-pack/1.0.0/TEMPLATE.md',
        import.meta.url,
      ),
    );
    await writeFile(join(sourceDirectory, 'TEMPLATE.md'), await readFile(templateFile, 'utf8'));

    const result = await validateResourceDirectory({
      sourceDirectory,
      resourceId: 'john-doe/templates/review-pack',
      version: '1.0.0',
    });

    expect(result.entryFile.path).toBe('TEMPLATE.md');
    expect(result.description).toBe('A review pack for TypeScript API changes.');
    expect(result.files).toHaveLength(1);
  });

  it('accepts an explicit description when the entry file has no usable text', async () => {
    const { sourceDirectory } = await createPublishFixture();
    await writeFile(join(sourceDirectory, 'SKILL.md'), '#\n', 'utf8');

    const result = await validateResourceDirectory({
      sourceDirectory,
      resourceId: 'jane-doe/skills/web-review',
      version: '1.0.0',
      description: 'Review web changes.',
    });

    expect(result.description).toBe('Review web changes.');
  });

  it('validates a self-contained plugin bundle manifest', async () => {
    const { sourceDirectory } = await createPublishFixture();
    await mkdir(join(sourceDirectory, '.claude-plugin'), { recursive: true });
    await writeFile(
      join(sourceDirectory, '.claude-plugin', 'plugin.json'),
      '{"name":"review-pack","description":"A review pack.","version":"1.0.0"}\n',
      'utf8',
    );

    const result = await validateResourceDirectory({
      sourceDirectory,
      resourceId: 'john-doe/plugins/review-pack',
      version: '1.0.0',
    });

    expect(result.resource.type).toBe('plugins');
    expect(result.entryFile.path).toBe('.claude-plugin/plugin.json');
    expect(result.description).toBe('A review pack.');
  });

  it('accepts a Codex-only plugin bundle', async () => {
    const { sourceDirectory } = await createPublishFixture();
    await mkdir(join(sourceDirectory, '.codex-plugin'), { recursive: true });
    await writeFile(
      join(sourceDirectory, '.codex-plugin', 'plugin.json'),
      '{"name":"review-pack","description":"A review pack."}\n',
      'utf8',
    );

    const result = await validateResourceDirectory({
      sourceDirectory,
      resourceId: 'john-doe/plugins/review-pack',
      version: '1.0.0',
    });

    expect(result.entryFile.path).toBe('.codex-plugin/plugin.json');
  });

  it('rejects a plugin bundle without any harness manifest', async () => {
    const { sourceDirectory } = await createPublishFixture();

    await expect(
      validateResourceDirectory({
        sourceDirectory,
        resourceId: 'john-doe/plugins/review-pack',
        version: '1.0.0',
      }),
    ).rejects.toThrow(
      'is missing .claude-plugin/plugin.json or .codex-plugin/plugin.json',
    );
  });

  it('rejects a plugin whose manifest name does not match the resource', async () => {
    const { sourceDirectory } = await createPublishFixture();
    await mkdir(join(sourceDirectory, '.claude-plugin'), { recursive: true });
    await writeFile(
      join(sourceDirectory, '.claude-plugin', 'plugin.json'),
      '{"name":"other-name","description":"A review pack."}\n',
      'utf8',
    );

    await expect(
      validateResourceDirectory({
        sourceDirectory,
        resourceId: 'john-doe/plugins/review-pack',
        version: '1.0.0',
      }),
    ).rejects.toThrow('Plugin manifest name does not match resource name');
  });

  it('reads a plugin manifest from a resource version', async () => {
    const version = await readResourceVersion(
      fileURLToPath(new URL('./fixtures/plugin-index.json', import.meta.url)),
      'john-doe/plugins/review-pack',
    );

    expect(readPluginManifest(version)).toEqual({
      file: { path: '.claude-plugin/plugin.json', content: expect.any(String) },
      manifest: {
        name: 'review-pack',
        description: 'A review pack.',
        version: '1.0.0',
      },
    });
  });

  it('validates a tool manifest with a command', async () => {
    const { sourceDirectory } = await createPublishFixture();
    await writeFile(
      join(sourceDirectory, 'TOOL.md'),
      '---\nname: rtk\ndescription: Reduce shell output.\ncommand: rtk\nruntime:\n  command: rtk\n  minimumVersion: 0.23.0\n  installers:\n    - manager: homebrew\n      package: rtk\nexecutables:\n  - bin/rtk\n---\n# RTK\n',
      'utf8',
    );
    await mkdir(join(sourceDirectory, 'bin'), { recursive: true });
    await writeFile(join(sourceDirectory, 'bin', 'rtk'), '#!/bin/sh\n', 'utf8');

    const result = await validateResourceDirectory({
      sourceDirectory,
      resourceId: 'john-doe/tools/rtk',
      version: '1.0.0',
    });

    expect(result.resource.type).toBe('tools');
    expect(result.description).toBe('Reduce shell output.');
    expect(readToolManifest({
      resource: {
        ...result.resource,
        description: result.description,
        latestVersion: '1.0.0',
        reviewStatus: 'unreviewed',
        lifecycleStatus: 'active',
        visibility: 'public',
        updatedAt: 'local',
      },
      version: '1.0.0',
      files: result.files,
    })).toEqual({
      name: 'rtk',
      description: 'Reduce shell output.',
      command: 'rtk',
      runtime: {
        command: 'rtk',
        minimumVersion: '0.23.0',
        installers: [{ manager: 'homebrew', package: 'rtk' }],
        dependencies: [],
      },
      executables: ['bin/rtk'],
    });
  });

  it('rejects a tool manifest without a command', async () => {
    const { sourceDirectory } = await createPublishFixture();
    await writeFile(
      join(sourceDirectory, 'TOOL.md'),
      '---\nname: rtk\ndescription: Reduce shell output.\n---\n# RTK\n',
      'utf8',
    );

    await expect(validateResourceDirectory({
      sourceDirectory,
      resourceId: 'john-doe/tools/rtk',
      version: '1.0.0',
    })).rejects.toThrow('Tool manifest is invalid');
  });
});

describe('publishResource', () => {
  it('publishes a new resource package and marks it unreviewed', async () => {
    const { indexPath, sourceDirectory, registryRoot } = await createPublishFixture();
    await mkdir(join(sourceDirectory, 'references'), { recursive: true });
    await writeFile(join(sourceDirectory, 'SKILL.md'), '# New skill\n', 'utf8');
    await writeFile(join(sourceDirectory, 'references', 'notes.md'), 'Notes\n', 'utf8');

    const result = await publishResource({
      indexPath,
      sourceDirectory,
      resourceId: 'jane-doe/skills/new-skill',
      version: '1.0.0',
      description: 'A new skill.',
    });

    expect(result.resource).toMatchObject({
      owner: 'jane-doe',
      type: 'skills',
      name: 'new-skill',
      latestVersion: '1.0.0',
      reviewStatus: 'unreviewed',
      lifecycleStatus: 'active',
      visibility: 'public',
    });
    await expect(
      readFile(
        join(registryRoot, 'resources', 'jane-doe', 'skills', 'new-skill', '1.0.0', 'SKILL.md'),
        'utf8',
      ),
    ).resolves.toBe('# New skill\n');
    await expect(readRegistryIndex(indexPath)).resolves.toMatchObject({
      resources: [expect.objectContaining({ name: 'new-skill', latestVersion: '1.0.0' })],
    });
  });

  it('requires each new version to increase and resets review status', async () => {
    const { indexPath, sourceDirectory } = await createPublishFixture();
    await writeFile(join(sourceDirectory, 'AGENT.md'), '# Agent v1\n', 'utf8');

    await publishResource({
      indexPath,
      sourceDirectory,
      resourceId: 'jane-doe/agents/reviewer',
      version: '1.0.0',
      description: 'Review changes.',
    });

    const reviewedIndex = await readRegistryIndex(indexPath);
    const reviewedResource = reviewedIndex.resources[0];

    if (!reviewedResource) {
      throw new Error('Expected the first published resource.');
    }

    await writeFile(
      indexPath,
      JSON.stringify(
        {
          ...reviewedIndex,
          resources: [{ ...reviewedResource, reviewStatus: 'reviewed' }],
        },
        null,
        2,
      ),
      'utf8',
    );

    await writeFile(join(sourceDirectory, 'AGENT.md'), '# Agent v2\n', 'utf8');
    const result = await publishResource({
      indexPath,
      sourceDirectory,
      resourceId: 'jane-doe/agents/reviewer',
      version: '1.1.0',
      description: 'Review changes with updated guidance.',
    });

    expect(result.resource.latestVersion).toBe('1.1.0');
    expect(result.resource.reviewStatus).toBe('unreviewed');
    await expect(
      publishResource({
        indexPath,
        sourceDirectory,
        resourceId: 'jane-doe/agents/reviewer',
        version: '1.0.1',
        description: 'An older version.',
      }),
    ).rejects.toThrow('Version must be greater than the current version 1.1.0');
  });
});

describe('submitResource', () => {
  it('creates a branch, pushes it, and opens a pull request', async () => {
    const { indexPath, sourceDirectory } = await createPublishFixture();
    await writeFile(join(sourceDirectory, 'SKILL.md'), '# Release check\n', 'utf8');
    const commands: string[] = [];

    const result = await submitResource({
      indexPath,
      sourceDirectory,
      resourceId: 'jane-doe/skills/release-check',
      version: '1.0.0',
      description: 'Check releases.',
      branch: 'submit/release-check-1.0.0',
      title: 'Submit release check',
      body: 'Please review.',
      commandRunner: async (command, args) => {
        commands.push(`${command} ${args.join(' ')}`);

        if (command === 'git' && args[0] === 'branch') {
          return { stdout: 'main\n', stderr: '' };
        }

        if (command === 'git' && args[0] === 'rev-parse') {
          return { stdout: 'abc123\n', stderr: '' };
        }

        if (command === 'gh' && args[0] === 'pr') {
          return { stdout: 'https://github.com/example/registry/pull/42\n', stderr: '' };
        }

        return { stdout: '', stderr: '' };
      },
    });

    expect(result).toMatchObject({
      branch: 'submit/release-check-1.0.0',
      commit: 'abc123',
      pullRequestUrl: 'https://github.com/example/registry/pull/42',
    });
    expect(commands).toEqual([
      'git status --porcelain --untracked-files=all',
      'git branch --show-current',
      'git remote get-url origin',
      'gh auth status',
      'git switch -c submit/release-check-1.0.0',
      'git add --sparse -- index.json resources/jane-doe/skills/release-check/1.0.0',
      'git commit -m Submit jane-doe/skills/release-check@1.0.0',
      'git rev-parse HEAD',
      'git push --set-upstream origin submit/release-check-1.0.0',
      'gh pr create --base main --head submit/release-check-1.0.0 --title Submit release check --body Please review.',
    ]);
  });

  it('refuses to submit from a dirty registry checkout', async () => {
    const { indexPath, sourceDirectory } = await createPublishFixture();

    await expect(
      submitResource({
        indexPath,
        sourceDirectory,
        resourceId: 'jane-doe/skills/release-check',
        version: '1.0.0',
        description: 'Check releases.',
        commandRunner: async () => ({ stdout: ' M index.json\n', stderr: '' }),
      }),
    ).rejects.toThrow('Registry working tree is not clean');
  });

  it('uses a temporary partial clone for remote repositories', async () => {
    const { indexPath, sourceDirectory } = await createPublishFixture();
    await writeFile(join(sourceDirectory, 'SKILL.md'), '# Remote release check\n', 'utf8');
    const commands: string[] = [];
    let temporaryRepository = '';

    const result = await submitResource({
      indexPath,
      sourceDirectory,
      repositoryUrl: 'git@example.com:company/registry.git',
      resourceId: 'jane-doe/skills/remote-check',
      version: '1.0.0',
      description: 'Check remote releases.',
      branch: 'submit/remote-check-1.0.0',
      commandRunner: async (command, args) => {
        commands.push(`${command} ${args.join(' ')}`);

        if (command === 'git' && args[0] === 'clone') {
          const destination = args.at(-1);

          if (!destination) {
            throw new Error('Missing clone destination.');
          }

          temporaryRepository = destination;
          await writeFile(
            join(destination, 'index.json'),
            JSON.stringify({ schemaVersion: 1, resources: [] }),
            'utf8',
          );
        }

        if (command === 'git' && args[0] === 'branch') {
          return { stdout: 'main\n', stderr: '' };
        }

        if (command === 'git' && args[0] === 'rev-parse') {
          return { stdout: 'def456\n', stderr: '' };
        }

        if (command === 'gh' && args[0] === 'pr') {
          return { stdout: 'https://github.com/example/registry/pull/43\n', stderr: '' };
        }

        return { stdout: '', stderr: '' };
      },
    });

    expect(result.pullRequestUrl).toBe('https://github.com/example/registry/pull/43');
    expect(commands.slice(0, 4)).toEqual([
      'git clone --filter=blob:none --no-checkout --branch main git@example.com:company/registry.git ' +
        temporaryRepository,
      'git sparse-checkout init --no-cone',
      'git sparse-checkout set index.json',
      'git checkout main',
    ]);
    await expect(readFile(join(temporaryRepository, 'index.json'), 'utf8')).rejects.toThrow();
  });
});

async function createPublishFixture(): Promise<{
  indexPath: string;
  sourceDirectory: string;
  registryRoot: string;
}> {
  const registryRoot = await mkdtemp(join(tmpdir(), 'ai-directory-publish-'));
  temporaryDirectories.push(registryRoot);

  const indexPath = join(registryRoot, 'index.json');
  const sourceDirectory = join(registryRoot, 'source');

  await mkdir(sourceDirectory, { recursive: true });
  await writeFile(
    indexPath,
    JSON.stringify({ schemaVersion: 1, resources: [] }, null, 2),
    'utf8',
  );

  return { indexPath, sourceDirectory, registryRoot };
}
