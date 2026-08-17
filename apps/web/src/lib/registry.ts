import { resolve } from 'node:path';
import { findWorkspaceRoot, getRepositorySetting } from '@ai-directory/config';
import {
  createRegistrySnapshot,
  readRegistrySourceIndex,
  readRegistrySourceResource,
  resolveRegistrySource,
  type RegistrySnapshot,
  type RegistrySource,
  type RegistrySourceOptions,
  type ResourceVersion,
} from '@ai-directory/registry';
import type { RegistryIndex, ResourceSummary } from '@ai-directory/contracts';

export interface RegistryView {
  index: RegistryIndex | null;
  indexPath?: string;
  source: 'local' | 'remote';
  repository?: string;
  error?: string;
}

type CachedRemoteRegistry = {
  key: string;
  promise: Promise<{ index: RegistryIndex; snapshot: RegistrySnapshot }>;
};

type RemoteRegistrySource = Extract<RegistrySource, { type: 'remote' }>;

let cachedRemoteRegistry: CachedRemoteRegistry | undefined;

function getConfigCwd(): string {
  return (
    process.env.AI_DIRECTORY_CONFIG_CWD ??
    findWorkspaceRoot(process.cwd()) ??
    process.cwd()
  );
}

export function getRegistryIndexPath(): string | undefined {
  const path = process.env.AI_DIRECTORY_REGISTRY_INDEX?.trim();
  return path
    ? resolve(process.env.AI_DIRECTORY_CONFIG_CWD ?? process.cwd(), path)
    : undefined;
}

export function resourceId(resource: Pick<ResourceSummary, 'owner' | 'type' | 'name'>): string {
  return `${resource.owner}/${resource.type}/${resource.name}`;
}

function remoteRegistryKey(source: RemoteRegistrySource): string {
  return `${source.repositoryUrl}\u0000${source.baseBranch}`;
}

async function getRemoteRegistry(
  source: RemoteRegistrySource,
): Promise<{ index: RegistryIndex; snapshot: RegistrySnapshot }> {
  const key = remoteRegistryKey(source);

  if (cachedRemoteRegistry?.key === key) return cachedRemoteRegistry.promise;

  const previous = cachedRemoteRegistry;
  const promise = (async () => {
    const snapshot = await createRegistrySnapshot(source);

    try {
      return { index: await snapshot.readIndex(), snapshot };
    } catch (error) {
      await snapshot.close();
      throw error;
    }
  })();

  cachedRemoteRegistry = { key, promise };

  if (previous) {
    void previous.promise.then(
      ({ snapshot }) => snapshot.close(),
      () => undefined,
    );
  }

  promise.catch(() => {
    if (cachedRemoteRegistry?.promise === promise) cachedRemoteRegistry = undefined;
  });

  return promise;
}

export async function refreshRegistry(): Promise<void> {
  const previous = cachedRemoteRegistry;
  cachedRemoteRegistry = undefined;

  if (previous) {
    await previous.promise.then(
      ({ snapshot }) => snapshot.close(),
      () => undefined,
    );
  }
}

export async function loadRegistry(): Promise<RegistryView> {
  const indexPath = getRegistryIndexPath();
  const repository = getRepositorySetting(undefined, getConfigCwd()).value;

  try {
    const sourceOptions: RegistrySourceOptions = {};
    if (indexPath) sourceOptions.indexPath = indexPath;
    if (repository) sourceOptions.repositoryUrl = repository;
    const source = resolveRegistrySource(sourceOptions);

    if (source.type === 'local') {
      return {
        index: await readRegistrySourceIndex(source),
        indexPath: source.indexPath,
        source: source.type,
      };
    }

    const registry = await getRemoteRegistry(source);
    return {
      index: registry.index,
      repository: source.repositoryUrl,
      source: source.type,
    };
  } catch (error) {
    const view: RegistryView = {
      index: null,
      source: indexPath ? 'local' : 'remote',
      error: error instanceof Error ? error.message : String(error),
    };
    if (indexPath) view.indexPath = indexPath;
    if (repository) view.repository = repository;

    return view;
  }
}

export async function loadResource(
  indexPath: string | undefined,
  resource: ResourceSummary,
  repository?: string,
): Promise<{ version: ResourceVersion | null; resources: ResourceVersion[]; error?: string }> {
  try {
    const sourceOptions: RegistrySourceOptions = {};
    if (indexPath) sourceOptions.indexPath = indexPath;
    if (repository) sourceOptions.repositoryUrl = repository;
    const source = resolveRegistrySource(sourceOptions);

    const result = source.type === 'remote'
      ? await (await getRemoteRegistry(source)).snapshot.readResource(
          resourceId(resource),
          resource.latestVersion,
        )
      : await readRegistrySourceResource(source, resourceId(resource), resource.latestVersion);
    return { version: result.resource, resources: result.resources };
  } catch (error) {
    return {
      version: null,
      resources: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
