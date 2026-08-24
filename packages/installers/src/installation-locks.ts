import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  isMissingPathError,
  isPathExistsError,
  pathExists,
} from '@ai-directory/config';
import { z } from 'zod';
import { installationManifestPath } from './installation-records.js';
import {
  currentFile,
  existingDirectoryAncestors,
  removeEmptyRollbackDirectories,
} from './file-snapshots.js';
import type { ResourceChangeOptions } from './resource-operation-types.js';

type InstallationLock = {
  release(): Promise<void>;
};

type InstallationLockOwner = {
  pid: number;
  token: string;
};

const installationLockSchema = z.object({
  pid: z.number().int().positive(),
  token: z.string(),
});

export async function withInstallationLocks<T>(
  operations: readonly unknown[],
  options: ResourceChangeOptions,
  action: () => Promise<T>,
): Promise<T> {
  const lockPaths = [...new Set(
    operations.map(() =>
      `${resolve(installationManifestPath(options))}.lock`,
    ),
  )].sort();
  const locks: InstallationLock[] = [];

  let acquisitionError: unknown;
  try {
    for (const path of lockPaths) locks.push(await acquireInstallationLock(path));
  } catch (error) {
    acquisitionError = error;
  }

  if (acquisitionError !== undefined) {
    await releaseLocks(locks);
    throw acquisitionError;
  }

  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    const value = await action();
    outcome = { ok: true, value };
  } catch (error) {
    outcome = { ok: false, error };
  }

  const releaseError = await releaseLocks(locks);

  if (!outcome.ok) throw releaseError ?? outcome.error;
  if (releaseError) throw releaseError;
  return outcome.value;
}

async function releaseLocks(locks: InstallationLock[]): Promise<Error | undefined> {
  let releaseError: Error | undefined;
  for (const lock of locks.reverse()) {
    try {
      await lock.release();
    } catch (error) {
      releaseError ??= toError(error);
    }
  }
  return releaseError;
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

async function acquireInstallationLock(path: string): Promise<InstallationLock> {
  const existingDirectories = new Set(await existingDirectoryAncestors(path));
  await mkdir(dirname(path), { recursive: true });
  const owner = { pid: process.pid, token: randomUUID() } satisfies InstallationLockOwner;
  const content = `${JSON.stringify(owner)}\n`;

  while (true) {
    try {
      const handle = await open(path, 'wx');
      try {
        await handle.writeFile(content, 'utf8');
      } catch (error) {
        await rm(path, { force: true });
        throw error;
      } finally {
        await handle.close();
      }

      return {
        release: async () => {
          if (await currentFile(path) === content) {
            await rm(path, { force: true });
            await removeEmptyRollbackDirectories(dirname(resolve(path)), existingDirectories);
          }
        },
      };
    } catch (error) {
      if (!isPathExistsError(error)) throw error;

      const existing = await readInstallationLock(path);
      if (!existing && !(await pathExists(path))) continue;
      if (!existing || isProcessRunning(existing.pid)) {
        throw new Error(`Another AI Directory installation is in progress: ${path}`);
      }

      await rm(path, { force: true });
    }
  }
}

async function readInstallationLock(path: string): Promise<InstallationLockOwner | null> {
  let content: string;

  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }

  try {
    const result = installationLockSchema.safeParse(JSON.parse(content));
    if (result.success) return { pid: result.data.pid, token: result.data.token };
  } catch {
    return null;
  }

  return null;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}
