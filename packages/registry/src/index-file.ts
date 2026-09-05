import { readFile, realpath } from 'node:fs/promises';
import { dirname, relative } from 'node:path';
import {
  registryIndexSchema,
  resourceIdSchema,
  resourceKey,
  resourceVersionSchema,
  type RegistryIndex,
} from '@ai-directory/contracts';
import { isMissingPathError, listFilesUnder } from '@ai-directory/config';
import { readTemplateManifest } from './manifests.js';
import { resourceDirectory } from './paths.js';
import type { ResourceFile, ResourceVersion } from './types.js';

export async function readRegistryIndex(filePath: string): Promise<RegistryIndex> {
  let contents: string;

  try {
    contents = await readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Registry index not found: ${filePath}`, { cause: error });
  }

  let data: unknown;

  try {
    data = JSON.parse(contents);
  } catch (error) {
    throw new Error(`Registry index is not valid JSON: ${filePath}`, { cause: error });
  }

  const result = registryIndexSchema.safeParse(data);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'index'}: ${issue.message}`)
      .join('; ');

    throw new Error(`Registry index is invalid (${filePath}): ${issues}`);
  }

  return result.data;
}

export async function readResourceVersion(
  indexPath: string,
  resourceId: string,
  requestedVersion?: string,
): Promise<ResourceVersion> {
  const { resource, version } = await findResourceVersion(indexPath, resourceId, requestedVersion);

  const directory = resourceDirectory(dirname(await realpath(indexPath)), resource, version);

  let files: ResourceFile[];

  try {
    const paths = await listFilesUnder(directory);
    files = await Promise.all(
      paths.map(async (path) => ({
        path: relative(directory, path),
        content: await readFile(path, 'utf8'),
      })),
    );
  } catch (error) {
    if (isMissingPathError(error)) {
      throw new Error(`Resource version not found: ${resourceId}@${version}`, { cause: error });
    }

    throw new Error(`Could not read resource version: ${resourceId}@${version}`, { cause: error });
  }

  if (files.length === 0) {
    throw new Error(`Resource version is empty: ${resourceId}@${version}`);
  }

  return { resource, version, files };
}

export async function findResourceVersion(
  indexPath: string,
  requestedResourceId: string,
  requestedVersion?: string,
): Promise<{ resource: RegistryIndex['resources'][number]; version: string }> {
  if (!resourceIdSchema.safeParse(requestedResourceId).success) {
    throw new Error(`Invalid resource ID: ${requestedResourceId}`);
  }

  const index = await readRegistryIndex(indexPath);
  const resource = index.resources.find((candidate) => resourceKey(candidate) === requestedResourceId);

  if (!resource) {
    throw new Error(`Resource not found: ${requestedResourceId}`);
  }

  const version = requestedVersion ?? resource.latestVersion;

  if (!resourceVersionSchema.safeParse(version).success) {
    throw new Error(`Invalid resource version: ${version}`);
  }

  return { resource, version };
}

export async function readTemplateResources(
  indexPath: string,
  template: ResourceVersion,
): Promise<ResourceVersion[]> {
  const manifest = readTemplateManifest(template);

  return Promise.all(
    manifest.resources.map((resource) =>
      readResourceVersion(indexPath, resource.id, resource.version),
    ),
  );
}
