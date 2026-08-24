import { lstat, readFile, rm, rmdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { isMissingPathError, writeFileAtomic } from '@ai-directory/config';

export type FileSnapshot = {
  path: string;
  content: string | null;
  existingDirectories?: string[];
};

export async function snapshotFiles(paths: string[]): Promise<FileSnapshot[]> {
  const snapshots: FileSnapshot[] = [];

  for (const path of new Set(paths)) {
    snapshots.push({
      path,
      content: await currentFile(path),
      existingDirectories: await existingDirectoryAncestors(path),
    });
  }

  return snapshots;
}

export async function restoreFiles(snapshots: FileSnapshot[]): Promise<void> {
  for (const snapshot of snapshots) {
    if (snapshot.content === null) {
      await rm(snapshot.path, { force: true });
    } else {
      await writeFileAtomic(snapshot.path, snapshot.content);
    }
  }

  const existingDirectories = new Set(
    snapshots.flatMap((snapshot) => snapshot.existingDirectories ?? []),
  );
  for (const snapshot of snapshots) {
    if (snapshot.content === null) {
      await removeEmptyRollbackDirectories(dirname(resolve(snapshot.path)), existingDirectories);
    }
  }
}

export async function existingDirectoryAncestors(path: string): Promise<string[]> {
  const existing: string[] = [];
  let current = dirname(resolve(path));

  while (current !== dirname(current)) {
    try {
      if (!(await lstat(current)).isDirectory()) break;
      existing.push(current);
    } catch (error) {
      if (isMissingPathError(error)) {
        current = dirname(current);
        continue;
      }
      throw error;
    }
    current = dirname(current);
  }

  return existing;
}

export async function removeEmptyRollbackDirectories(
  start: string,
  existingDirectories: Set<string>,
): Promise<void> {
  let current = resolve(start);

  while (current !== dirname(current) && !existingDirectories.has(current)) {
    try {
      await rmdir(current);
    } catch (error) {
      if (isMissingPathError(error)) {
        current = dirname(current);
        continue;
      }
      const code = error instanceof Error && 'code' in error
        ? error.code
        : undefined;
      if (code === 'ENOTEMPTY' || code === 'EEXIST' || code === 'ENOTDIR') break;
      throw error;
    }
    current = dirname(current);
  }
}

export async function currentFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
}
