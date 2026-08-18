import { resolve } from 'node:path';
import { findWorkspaceRoot, getRepositorySetting } from '@ai-directory/config';
import {
  createCachedRegistry,
  readRegistrySourceIndex,
  readRegistrySourceResource,
  resolveRegistrySource,
  type RegistrySourceOptions,
  type ResourceVersion,
} from '@ai-directory/registry';
import type { RegistryIndex, ResourceSummary } from '@ai-directory/contracts';
import { resourceKey } from '@ai-directory/contracts';

export interface RegistryView {
  index: RegistryIndex | null;
  indexPath?: string;
  source: 'local' | 'remote';
  repository?: string;
  error?: string;
}

const cachedRegistry = createCachedRegistry();

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

export function refreshRegistry(): Promise<void> {
  return cachedRegistry.refresh();
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

    const snapshot = await cachedRegistry.get(source);
    return {
      index: await snapshot.readIndex(),
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
      ? await (await cachedRegistry.get(source)).readResource(
          resourceKey(resource),
          resource.latestVersion,
        )
      : await readRegistrySourceResource(source, resourceKey(resource), resource.latestVersion);
    return { version: result.resource, resources: result.resources };
  } catch (error) {
    return {
      version: null,
      resources: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
