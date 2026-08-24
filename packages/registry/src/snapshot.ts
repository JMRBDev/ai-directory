import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resourceKey, type RegistryIndex } from '@ai-directory/contracts';
import { readRegistryIndex, readResourceVersion, readTemplateResources, findResourceVersion } from './index-file.js';
import { clonePartialRepository, runCommand, setSparseCheckout } from './git.js';
import { resourcePackagePath } from './paths.js';
import { readTemplateManifest } from './manifests.js';
import type {
  CommandRunner,
  RegistrySnapshot,
  RegistrySource,
  RemoteRegistryOptions,
  RemoteResourceOptions,
  RemoteResourceResult,
} from './types.js';

export async function createRegistrySnapshot(
  source: RegistrySource,
  commandRunner: CommandRunner = runCommand,
): Promise<RegistrySnapshot> {
  if (source.type === 'local') {
    return {
      source,
      indexPath: source.indexPath,
      readIndex: () => readRegistryIndex(source.indexPath),
      readResource: async (resourceId, version) => {
        const resource = await readResourceVersion(source.indexPath, resourceId, version);

        return {
          resource,
          resources:
            resource.resource.type === 'templates'
              ? await readTemplateResources(source.indexPath, resource)
              : [resource],
        };
      },
      close: async () => undefined,
    };
  }

  const temporaryRepository = await mkdtemp(join(tmpdir(), 'ai-directory-snapshot-'));

  try {
    await clonePartialRepository(
      commandRunner,
      source.repositoryUrl,
      temporaryRepository,
      source.baseBranch,
    );

    return createRemoteRegistrySnapshot(source, temporaryRepository, commandRunner);
  } catch (error) {
    await rm(temporaryRepository, { recursive: true, force: true });
    throw error;
  }
}

function createRemoteRegistrySnapshot(
  source: Extract<RegistrySource, { type: 'remote' }>,
  repositoryRoot: string,
  runner: CommandRunner,
): RegistrySnapshot {
  const indexPath = join(repositoryRoot, 'index.json');
  const patterns = new Set(['index.json']);
  let sparseUpdate = Promise.resolve();
  let closed = false;
  let closePromise: Promise<void> | undefined;

  async function ensurePaths(paths: string[]): Promise<void> {
    if (closed) throw new Error('Registry snapshot is closed.');

    for (const path of paths) patterns.add(path);

    sparseUpdate = sparseUpdate.then(() =>
      setSparseCheckout(runner, repositoryRoot, [...patterns]),
    );
    await sparseUpdate;
  }

  async function readResource(resourceId: string, version?: string): Promise<RemoteResourceResult> {
    const target = await findResourceVersion(indexPath, resourceId, version);
    const targetPattern = resourcePackagePath(target.resource, target.version);

    await ensurePaths([targetPattern]);
    const resource = await readResourceVersion(indexPath, resourceId, target.version);

    if (resource.resource.type !== 'templates') {
      return { resource, resources: [resource] };
    }

    const manifest = readTemplateManifest(resource);
    const dependencies = await Promise.all(
      manifest.resources.map((dependency) =>
        findResourceVersion(indexPath, dependency.id, dependency.version),
      ),
    );

    await ensurePaths(
      dependencies.map((dependency) =>
        resourcePackagePath(dependency.resource, dependency.version),
      ),
    );

    const resources = await Promise.all(
      dependencies.map((dependency) =>
        readResourceVersion(indexPath, resourceKey(dependency.resource), dependency.version),
      ),
    );

    return { resource, resources };
  }

  return {
    source,
    indexPath,
    readIndex: () => readRegistryIndex(indexPath),
    readResource,
    close: async () => {
      if (closePromise) return closePromise;

      closed = true;
      closePromise = sparseUpdate
        .catch(() => undefined)
        .then(() => rm(repositoryRoot, { recursive: true, force: true }));
      return closePromise;
    },
  };
}

export async function readRemoteRegistryIndex(
  options: RemoteRegistryOptions,
): Promise<RegistryIndex> {
  const snapshot = await createRegistrySnapshot(
    {
      type: 'remote',
      repositoryUrl: options.repositoryUrl,
      baseBranch: options.baseBranch ?? 'main',
    },
    options.commandRunner,
  );

  try {
    return await snapshot.readIndex();
  } finally {
    await snapshot.close();
  }
}

export async function readRemoteResource(
  options: RemoteResourceOptions,
): Promise<RemoteResourceResult> {
  const snapshot = await createRegistrySnapshot(
    {
      type: 'remote',
      repositoryUrl: options.repositoryUrl,
      baseBranch: options.baseBranch ?? 'main',
    },
    options.commandRunner,
  );

  try {
    return await snapshot.readResource(options.resourceId, options.version);
  } finally {
    await snapshot.close();
  }
}
