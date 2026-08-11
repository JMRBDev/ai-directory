import { dirname, join } from 'node:path';
import { readdir, readFile, realpath } from 'node:fs/promises';
import {
  registryIndexSchema,
  resourceVersionSchema,
  type ResourceSummary,
  type RegistryIndex,
} from '@ai-directory/contracts';
import { resourceKey } from '@ai-directory/domain';

export type ResourceFile = {
  path: string;
  content: string;
};

export type ResourceVersion = {
  resource: ResourceSummary;
  version: string;
  files: ResourceFile[];
};

function parseRegistryIndex(data: unknown, source: string): RegistryIndex {
  const result = registryIndexSchema.safeParse(data);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'index'}: ${issue.message}`)
      .join('; ');

    throw new Error(`Registry index is invalid (${source}): ${issues}`);
  }

  return result.data;
}

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

  return parseRegistryIndex(data, filePath);
}

export async function fetchRegistryIndex(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<RegistryIndex> {
  let response: Response;

  try {
    response = await fetcher(url);
  } catch (error) {
    throw new Error(`Could not fetch registry index: ${url}`, { cause: error });
  }

  if (!response.ok) {
    throw new Error(
      `Registry index request failed (${response.status} ${response.statusText}): ${url}`,
    );
  }

  let data: unknown;

  try {
    data = await response.json();
  } catch (error) {
    throw new Error(`Registry index response is not valid JSON: ${url}`, { cause: error });
  }

  return parseRegistryIndex(data, url);
}

async function readResourceFiles(directory: string, prefix = ''): Promise<ResourceFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)).map(async (entry) => {
      const filePath = join(directory, entry.name);
      const resourcePath = prefix ? join(prefix, entry.name) : entry.name;

      if (entry.isDirectory()) {
        return readResourceFiles(filePath, resourcePath);
      }

      return [{ path: resourcePath, content: await readFile(filePath, 'utf8') }];
    }),
  );

  return files.flat();
}

export async function readResourceVersion(
  indexPath: string,
  resourceId: string,
  requestedVersion?: string,
): Promise<ResourceVersion> {
  const index = await readRegistryIndex(indexPath);
  const resource = index.resources.find((candidate) => resourceKey(candidate) === resourceId);

  if (!resource) {
    throw new Error(`Resource not found: ${resourceId}`);
  }

  const version = requestedVersion ?? resource.latestVersion;

  if (!resourceVersionSchema.safeParse(version).success) {
    throw new Error(`Invalid resource version: ${version}`);
  }

  const directory = join(
    dirname(await realpath(indexPath)),
    'resources',
    resource.owner,
    resource.type,
    resource.name,
    version,
  );

  let files: ResourceFile[];

  try {
    files = await readResourceFiles(directory);
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

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
