import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { detectResourceCandidates, validateResourceDirectory } from '../src/index.js';
import { cleanupTemporaryDirectories, createPublishFixture } from './helpers.js';

afterEach(cleanupTemporaryDirectories);

describe('resource detection', () => {
  it('reports detected resource folders when the entry file is missing', async () => {
    const { sourceDirectory } = await createPublishFixture();
    await mkdir(join(sourceDirectory, 'skills', 'code-review'), { recursive: true });
    await mkdir(join(sourceDirectory, 'agents', 'reviewer'), { recursive: true });
    await writeFile(join(sourceDirectory, 'skills', 'code-review', 'SKILL.md'), '# Review\n', 'utf8');
    await writeFile(join(sourceDirectory, 'agents', 'reviewer', 'AGENT.md'), '# Agent\n', 'utf8');

    await expect(
      validateResourceDirectory({
        sourceDirectory,
        resourceId: 'jane-doe/skills/web-review',
        version: '1.0.0',
      }),
    ).rejects.toThrow(
      'The folder contains other resources: agents/reviewer (AGENT.md, agents), skills/code-review (SKILL.md, skills)',
    );
  });

  it('lists resource candidates found under a directory', async () => {
    const { sourceDirectory } = await createPublishFixture();
    await mkdir(join(sourceDirectory, 'pack', 'skills', 'code-review'), { recursive: true });
    await writeFile(
      join(sourceDirectory, 'pack', 'skills', 'code-review', 'SKILL.md'),
      '# Review\n',
      'utf8',
    );

    expect(await detectResourceCandidates(sourceDirectory)).toEqual([
      {
        type: 'skills',
        entryFile: 'SKILL.md',
        root: join('pack', 'skills', 'code-review'),
        name: 'code-review',
      },
    ]);
  });
});
