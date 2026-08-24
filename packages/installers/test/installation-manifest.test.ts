import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readInstallationManifest,
  removeStaleInstallationFiles,
  updateInstallationManifest,
  type InstallationRecord,
} from '../src/index.js';
import { cleanupTemporaryDirectories, createTemporaryDirectory } from './fixtures.js';

afterEach(cleanupTemporaryDirectories);

describe('installation manifest', () => {
  it('reads missing manifests and replaces records by resource', async () => {
    const directory = await createTemporaryDirectory();
    const path = join(directory, 'installed.json');
    const record = {
      resource: 'jose-rosendo/skills/typescript-api-review',
      version: '1.0.0',
      harness: 'claude-code',
      destination: join(directory, '.claude', 'skills', 'typescript-api-review'),
      files: [join(directory, '.claude', 'skills', 'typescript-api-review', 'SKILL.md')],
      installedAt: '2026-08-11T10:00:00.000Z',
    } satisfies InstallationRecord;

    await expect(readInstallationManifest(path)).resolves.toEqual({
      schemaVersion: 1,
      installations: [],
      dependencies: [],
      packs: [],
    });
    await updateInstallationManifest(path, [record]);
    await updateInstallationManifest(path, [{ ...record, version: '1.1.0' }]);

    await expect(readInstallationManifest(path)).resolves.toMatchObject({
      installations: [expect.objectContaining({ version: '1.1.0' })],
    });
  });

  it('removes files left by an older installation', async () => {
    const directory = await createTemporaryDirectory();
    const oldFile = join(directory, 'old.md');
    await writeFile(oldFile, 'old\n', 'utf8');

    const record = {
      resource: 'jose-rosendo/skills/typescript-api-review',
      version: '1.0.0',
      harness: 'claude-code',
      destination: directory,
      files: [oldFile],
      fileHashes: {
        [oldFile]: createHash('sha256').update('old\n').digest('hex'),
      },
      installedAt: '2026-08-11T10:00:00.000Z',
    } satisfies InstallationRecord;

    await removeStaleInstallationFiles([record], []);
    await expect(readFile(oldFile, 'utf8')).rejects.toThrow();
  });
});
