import { resourceKey, resourceEntryFiles, type RegistryIndex, type ResourceSummary } from '@ai-directory/contracts';
import { isMissingPathError } from '@ai-directory/config';
import { readRegistryIndex, readResourceVersion } from './index-file.js';
import { readRemoteRegistryIndex, readRemoteResource } from './snapshot.js';
import { readToolManifest } from './manifests.js';
import type {
  RegistryValidationResult,
  RemoteRegistryOptions,
  ResourceVersion,
} from './types.js';

export async function validateRegistry(indexPath: string): Promise<RegistryValidationResult> {
  const index = await readRegistryIndex(indexPath);
  return validateResourceIndex(index, (resource) =>
    readResourceVersion(indexPath, resourceKey(resource), resource.latestVersion),
  );
}

export async function validateRemoteRegistry(
  options: RemoteRegistryOptions,
): Promise<RegistryValidationResult> {
  const index = await readRemoteRegistryIndex(options);

  return validateResourceIndex(index, async (resource) => {
    const resourceOptions: Parameters<typeof readRemoteResource>[0] = {
      repositoryUrl: options.repositoryUrl,
      resourceId: resourceKey(resource),
      version: resource.latestVersion,
    };
    if (options.baseBranch) resourceOptions.baseBranch = options.baseBranch;
    if (options.commandRunner) resourceOptions.commandRunner = options.commandRunner;

    return (await readRemoteResource(resourceOptions)).resource;
  });
}

async function validateResourceIndex(
  index: RegistryIndex,
  readVersion: (resource: ResourceSummary) => Promise<ResourceVersion>,
): Promise<RegistryValidationResult> {
  const issues: string[] = [];
  const resourceIds = new Set<string>();

  for (const resource of index.resources) {
    const id = resourceKey(resource);
    const requestedVersion = resource.latestVersion;

    if (resourceIds.has(id)) {
      issues.push(`Duplicate resource ID: ${id}`);
      continue;
    }

    resourceIds.add(id);

    try {
      const loadedVersion = await readVersion(resource);
      const files = loadedVersion.files;
      const entryFile = files.find((file) =>
        resourceEntryFiles(resource.type).includes(file.path),
      );

      if (!entryFile) {
        issues.push(
          `${id}@${requestedVersion} is missing ${resourceEntryFiles(resource.type).join(' or ')}`,
        );
      } else if (!entryFile.content.trim()) {
        issues.push(`${id}@${requestedVersion} has an empty ${entryFile.path}`);
      }

      if (resource.type === 'tools') {
        readToolManifest(loadedVersion);
      }
    } catch (error) {
      if (isMissingPathError(error)) {
        issues.push(`Resource version not found: ${id}@${requestedVersion}`);
      } else {
        issues.push(`Could not read resource version: ${id}@${requestedVersion}`);
      }
    }
  }

  return { resourceCount: index.resources.length, issues };
}
