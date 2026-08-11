import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  fetchRegistryIndex,
  publishResource,
  readRemoteResource,
  readRegistryIndex,
  readResourceVersion,
  readTemplateManifest,
  readTemplateResources,
  submitResource,
  validateRegistry,
} from '../src/index.js';

const fixturePath = fileURLToPath(new URL('./fixtures/index.json', import.meta.url));
const invalidIndexPath = fileURLToPath(new URL('./fixtures/invalid-index.json', import.meta.url));
const duplicateIndexPath = fileURLToPath(new URL('./fixtures/duplicate-index.json', import.meta.url));
const templateIndexPath = fileURLToPath(new URL('./fixtures/template-index.json', import.meta.url));
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

  it('loads an index from a remote source', async () => {
    const index = await fetchRegistryIndex(
      'https://registry.test/index.json',
      async () =>
        new Response(JSON.stringify({ schemaVersion: 1, resources: [] }), { status: 200 }),
    );

    expect(index.resources).toEqual([]);
  });

  it('reports remote HTTP failures clearly', async () => {
    await expect(
      fetchRegistryIndex(
        'https://registry.test/index.json',
        async () => new Response(null, { status: 503, statusText: 'Unavailable' }),
      ),
    ).rejects.toThrow('Registry index request failed (503 Unavailable)');
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
      'git add -- index.json resources/jane-doe/skills/release-check/1.0.0',
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
