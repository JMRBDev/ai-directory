import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { publishResource, readRegistryIndex } from '../src/index.js';
import { cleanupTemporaryDirectories, createPublishFixture } from './helpers.js';

afterEach(cleanupTemporaryDirectories);

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
