import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseResourceUpload, withResourceUpload } from '../src/index.js';
import type { ResourceUpload } from '../src/index.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ai-directory-server-upload-'));
  temporaryDirectories.push(directory);
  return directory;
}

function upload(overrides: Partial<ResourceUpload> = {}): ResourceUpload {
  return {
    resourceId: 'jane-doe/skills/web-review',
    version: '1.0.0',
    files: [new File(['# Web review\n'], 'SKILL.md', { type: 'text/markdown' })],
    ...overrides,
  };
}

describe('parseResourceUpload', () => {
  it('parses a valid multipart body with nested files', () => {
    const result = parseResourceUpload({
      resourceId: 'jane-doe/skills/web-review',
      version: '1.0.0',
      description: 'Review the web.',
      'files[]': [
        new File(['# Web review\n'], 'SKILL.md'),
        new File(['- check a11y\n'], 'references/checklist.md'),
      ],
    });

    expect(result).toEqual({
      ok: true,
      upload: {
        resourceId: 'jane-doe/skills/web-review',
        version: '1.0.0',
        description: 'Review the web.',
        files: [
          expect.objectContaining({ name: 'SKILL.md' }),
          expect.objectContaining({ name: 'references/checklist.md' }),
        ],
      },
    });
  });

  it('reads files from the legacy files field', () => {
    const result = parseResourceUpload({
      resourceId: 'jane-doe/skills/web-review',
      version: '1.0.0',
      files: new File(['# Web review\n'], 'SKILL.md'),
    });

    expect(result.ok).toBe(true);
  });

  it('rejects a missing resourceId', () => {
    expect(parseResourceUpload({ version: '1.0.0', files: [new File([], 'SKILL.md')] })).toEqual({
      ok: false,
      error: 'resourceId must be a non-empty string.',
    });
  });

  it('rejects a missing version', () => {
    expect(parseResourceUpload({ resourceId: 'jane-doe/skills/web-review', files: [new File([], 'SKILL.md')] })).toEqual({
      ok: false,
      error: 'version must be a non-empty string.',
    });
  });

  it('rejects an upload without files', () => {
    expect(parseResourceUpload({
      resourceId: 'jane-doe/skills/web-review',
      version: '1.0.0',
      files: [],
    })).toEqual({
      ok: false,
      error: 'files must include a resource directory.',
    });
  });
});

describe('withResourceUpload', () => {
  it('writes nested files and exposes their relative paths', async () => {
    const directory = await createTemporaryDirectory();
    const written: string[] = [];

    const result = await withResourceUpload(upload({
      files: [
        new File(['# Web review\n'], 'SKILL.md'),
        new File(['- check a11y\n'], 'references/checklist.md'),
      ],
    }), async (sourceDirectory) => {
      const files = [
        join(sourceDirectory, 'SKILL.md'),
        join(sourceDirectory, 'references', 'checklist.md'),
      ];
      for (const file of files) {
        written.push(await readFile(file, 'utf8'));
      }
      expect(directory).not.toContain(sourceDirectory);
      return sourceDirectory;
    });

    expect(written).toEqual(['# Web review\n', '- check a11y\n']);
    await expect(stat(result)).rejects.toThrow();
  });

  it('rejects an absolute upload path', async () => {
    await expect(withResourceUpload(upload({
      files: [new File(['# Web review\n'], '/etc/SKILL.md')],
    }), async () => undefined)).rejects.toThrow('Uploaded file path must be relative: /etc/SKILL.md');
  });

  it('rejects a traversal upload path', async () => {
    await expect(withResourceUpload(upload({
      files: [new File(['# Web review\n'], 'a/../../SKILL.md')],
    }), async () => undefined)).rejects.toThrow('Invalid uploaded file path: a/../../SKILL.md');
  });

  it('rejects a backslash traversal path and normalizes separators', async () => {
    await expect(withResourceUpload(upload({
      files: [new File(['# Web review\n'], '..\\SKILL.md')],
    }), async () => undefined)).rejects.toThrow('Invalid uploaded file path: ..\\SKILL.md');
  });

  it('cleans up the temporary directory when the action throws', async () => {
    let source: string | undefined;

    await expect(withResourceUpload(upload(), async (sourceDirectory) => {
      source = sourceDirectory;
      throw new Error('Validation failed.');
    })).rejects.toThrow('Validation failed.');

    if (!source) throw new Error('Expected the action to receive a source directory.');
    await expect(stat(source)).rejects.toThrow();
  });
});
