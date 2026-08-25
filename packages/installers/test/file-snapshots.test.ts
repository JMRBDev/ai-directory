import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { currentFile, restoreFiles, snapshotFiles } from '../src/file-snapshots.js';
import { cleanupTemporaryDirectories, createTemporaryDirectory } from './fixtures.js';

afterEach(cleanupTemporaryDirectories);

describe('file snapshots', () => {
  it('restores modified and deleted files to their snapshot content', async () => {
    const directory = await createTemporaryDirectory();
    const modifiedPath = join(directory, 'modified.md');
    const deletedPath = join(directory, 'deleted.md');
    await writeFile(modifiedPath, 'original\n', 'utf8');
    await writeFile(deletedPath, 'kept\n', 'utf8');

    const snapshots = await snapshotFiles([modifiedPath, deletedPath]);
    await writeFile(modifiedPath, 'changed\n', 'utf8');
    await rm(deletedPath);

    await restoreFiles(snapshots);

    await expect(readFile(modifiedPath, 'utf8')).resolves.toBe('original\n');
    await expect(readFile(deletedPath, 'utf8')).resolves.toBe('kept\n');
  });

  it('removes created files and their created directories on restore', async () => {
    const directory = await createTemporaryDirectory();
    const createdPath = join(directory, 'new', 'nested', 'SKILL.md');

    const snapshots = await snapshotFiles([createdPath]);
    await mkdir(join(directory, 'new', 'nested'), { recursive: true });
    await writeFile(createdPath, 'created\n', 'utf8');

    await restoreFiles(snapshots);

    await expect(lstat(createdPath)).rejects.toThrow();
    await expect(lstat(join(directory, 'new'))).rejects.toThrow();
  });

  it('keeps directories that existed before the snapshot', async () => {
    const directory = await createTemporaryDirectory();
    const existingDirectory = join(directory, 'existing');
    const createdPath = join(existingDirectory, 'SKILL.md');
    await mkdir(existingDirectory);

    const snapshots = await snapshotFiles([createdPath]);
    await writeFile(createdPath, 'created\n', 'utf8');

    await restoreFiles(snapshots);

    await expect(lstat(createdPath)).rejects.toThrow();
    await expect(lstat(existingDirectory)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
  });

  it('deduplicates snapshot paths and reads missing files as null', async () => {
    const directory = await createTemporaryDirectory();
    const path = join(directory, 'SKILL.md');
    await writeFile(path, 'content\n', 'utf8');

    const snapshots = await snapshotFiles([path, path]);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.content).toBe('content\n');

    await expect(currentFile(join(directory, 'missing.md'))).resolves.toBeNull();
  });
});
