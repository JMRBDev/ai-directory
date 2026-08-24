import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readPluginManifest, readResourceVersion, readToolManifest, validateResourceDirectory } from '../src/index.js';
import { cleanupTemporaryDirectories, createPublishFixture } from './helpers.js';

afterEach(cleanupTemporaryDirectories);

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
