import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createRegistrySnapshot,
  isResourceVersionOutdated,
  readMcpServerManifest,
  readRegistryIndex,
  readRemoteRegistryIndex,
  readRemoteResource,
  readResourceVersion,
  readTemplateManifest,
  readTemplateResources,
  resolveRegistrySource,
  validateRegistry,
  validateRemoteRegistry,
} from '../src/index.js';
import {
  cleanupTemporaryDirectories,
  duplicateIndexPath,
  fixturePath,
  invalidIndexPath,
  mcpIndexPath,
  templateIndexPath,
} from './helpers.js';

afterEach(cleanupTemporaryDirectories);

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
