import { gt as isGreaterVersion, valid as isValidVersion } from 'semver';
import { resourceKey, type RegistryIndex } from '@ai-directory/contracts';
import {
  createRegistrySnapshot,
  readRemoteRegistryIndex,
  readRemoteResource,
} from './snapshot.js';
import { readRegistryIndex, readResourceVersion, readTemplateResources } from './index-file.js';
import type {
  AggregatedRegistryIdentity,
  AggregatedRegistryResult,
  AggregatedResourceEntry,
  CachedRegistry,
  RegistrySnapshot,
  RegistrySource,
  RegistrySourceOptions,
  RegistryValidationResult,
  RemoteResourceOptions,
  RemoteResourceResult,
} from './types.js';
import { validateRemoteRegistry, validateRegistry } from './validate.js';
import { assertSafeRepositoryUrl } from './git.js';

export function resolveRegistrySource(options: RegistrySourceOptions): RegistrySource {
  if (options.indexPath?.trim()) {
    return { type: 'local', indexPath: options.indexPath.trim() };
  }

  if (options.repositoryUrl?.trim()) {
    const repositoryUrl = options.repositoryUrl.trim();
    assertSafeRepositoryUrl(repositoryUrl);
    return {
      type: 'remote',
      repositoryUrl,
      baseBranch: options.baseBranch?.trim() || 'main',
    };
  }

  throw new Error('No registry source configured. Run `aid setup` or pass `--index <path>`.');
}

export function createCachedRegistry(): CachedRegistry {
  let cached: { key: string; promise: Promise<RegistrySnapshot> } | undefined;

  return {
    get(source) {
      const key = source.type === 'remote'
        ? `remote\0${source.repositoryUrl}\0${source.baseBranch}`
        : `local\0${source.indexPath}`;

      if (cached?.key === key) return cached.promise;

      const previous = cached;
      const promise = createRegistrySnapshot(source);

      cached = { key, promise };

      if (previous) {
        void previous.promise.then(
          (snapshot) => snapshot.close(),
          () => undefined,
        );
      }

      promise.catch(() => {
        if (cached?.promise === promise) cached = undefined;
      });

      return promise;
    },
    async refresh() {
      const previous = cached;
      cached = undefined;

      if (previous) {
        await previous.promise.then(
          (snapshot) => snapshot.close(),
          () => undefined,
        );
      }
    },
  };
}

export function readRegistrySourceIndex(source: RegistrySource): Promise<RegistryIndex> {
  return source.type === 'local'
    ? readRegistryIndex(source.indexPath)
    : readRemoteRegistryIndex({
        repositoryUrl: source.repositoryUrl,
        baseBranch: source.baseBranch,
    });
}

export function isResourceVersionOutdated(
  currentVersion: string,
  latestVersion: string,
): boolean {
  return isValidVersion(currentVersion) !== null
    && isValidVersion(latestVersion) !== null
    && isGreaterVersion(latestVersion, currentVersion);
}

export function readRegistrySourceResource(
  source: RegistrySource,
  resourceId: string,
  version?: string,
): Promise<RemoteResourceResult> {
  if (source.type === 'remote') {
    const options: RemoteResourceOptions = {
      repositoryUrl: source.repositoryUrl,
      resourceId,
      baseBranch: source.baseBranch,
    };
    if (version !== undefined) options.version = version;

    return readRemoteResource(options);
  }

  return readResourceVersion(source.indexPath, resourceId, version).then(async (resource) => ({
    resource,
    resources:
      resource.resource.type === 'templates'
        ? await readTemplateResources(source.indexPath, resource)
        : [resource],
  }));
}

export function validateRegistrySource(source: RegistrySource): Promise<RegistryValidationResult> {
  return source.type === 'local'
    ? validateRegistry(source.indexPath)
    : validateRemoteRegistry({
        repositoryUrl: source.repositoryUrl,
        baseBranch: source.baseBranch,
      });
}

export async function aggregateRegistrySources(
  sources: Array<{ source: RegistrySource; registry: AggregatedRegistryIdentity }>,
): Promise<AggregatedRegistryResult> {
  const registries = sources.map((entry) => entry.registry);
  const entriesById = new Map<string, AggregatedResourceEntry>();
  const errors: AggregatedRegistryResult['errors'] = [];

  for (const entry of sources) {
    try {
      const index = await readRegistrySourceIndex(entry.source);
      for (const summary of index.resources) {
        const id = resourceKey(summary);
        const candidate = { summary, registry: entry.registry };
        const existing = entriesById.get(id);
        if (!existing) {
          entriesById.set(id, {
            resource: id,
            type: summary.type,
            entries: [candidate],
            primary: candidate,
          });
          continue;
        }
        existing.entries.push(candidate);
      }
    } catch (error) {
      errors.push({
        registry: entry.registry,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Priority wins: the first source that carries an id owns display and
  // default install. Version never overrides priority.
  const entries = [...entriesById.values()].sort((left, right) =>
    left.resource.localeCompare(right.resource),
  );

  return { entries, registries, errors };
}
