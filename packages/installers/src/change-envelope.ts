import { errorMessage } from './errors.js';
import { fingerprintPaths } from './hashing.js';
import { restoreFiles, snapshotFiles } from './file-snapshots.js';
import { withInstallationLocks } from './installation-locks.js';
import type { ResourceChangeOptions } from './resource-operation-types.js';

export async function applyChangePlanEnvelope<T, P extends { fingerprint: string; conflicts: string[] }>(
  operations: readonly unknown[],
  options: ResourceChangeOptions,
  force: boolean,
  planned: P | undefined,
  planOperations: () => Promise<P>,
  pathsFor: (plan: P) => string[],
  applyAction: (plan: P) => Promise<T>,
  rollbackPrefix: string,
): Promise<T> {
  return withInstallationLocks(operations, options, async () => {
    const plan = planned ?? await planOperations();
    if (planned) {
      const fingerprint = await fingerprintPaths(pathsFor(plan));
      if (fingerprint !== plan.fingerprint) {
        throw new Error('Change plan is outdated. Generate a new preview before applying.');
      }
    }
    if (plan.conflicts.length > 0 && !force) {
      throw new Error(`Change plan contains conflicts: ${plan.conflicts.join(' ')}`);
    }

    const snapshots = await snapshotFiles(pathsFor(plan));

    try {
      return await applyAction(plan);
    } catch (error) {
      try {
        await restoreFiles(snapshots);
      } catch (rollbackError) {
        throw new Error(
          `${rollbackPrefix}. Rollback failed; manual review may be required.\nRollback error: ${errorMessage(rollbackError)}\nOriginal error: ${errorMessage(error)}`,
          { cause: error },
        );
      }
      throw new Error(
        `${rollbackPrefix}. All changes were rolled back.\nCause: ${errorMessage(error)}`,
        { cause: error },
      );
    }
  });
}
