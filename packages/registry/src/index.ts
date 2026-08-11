import { dirname, join } from 'node:path';
import { readdir, readFile, realpath } from 'node:fs/promises';
import {
  registryIndexSchema,
  resourceVersionSchema,
  type ResourceType,
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

export type RegistryValidationResult = {
  resourceCount: number;
  issues: string[];
};

const requiredEntryFiles: Record<ResourceType, string> = {
  skills: 'SKILL.md',
  agents: 'AGENT.md',
  rules: 'RULE.md',
  templates: 'TEMPLATE.md',
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
    entries
      .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
      .map(async (entry) => {
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

  const directory = resourceDirectory(dirname(await realpath(indexPath)), resource, version);

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

export async function validateRegistry(indexPath: string): Promise<RegistryValidationResult> {
  const index = await readRegistryIndex(indexPath);
  const registryRoot = dirname(await realpath(indexPath));
  const issues: string[] = [];
  const resourceIds = new Set<string>();

  for (const resource of index.resources) {
    const id = resourceKey(resource);
    const version = resource.latestVersion;

    if (resourceIds.has(id)) {
      issues.push(`Duplicate resource ID: ${id}`);
      continue;
    }

    resourceIds.add(id);

    try {
      const files = await readResourceFiles(resourceDirectory(registryRoot, resource, version));
      const entryFile = files.find((file) => file.path === requiredEntryFiles[resource.type]);

      if (!entryFile) {
        issues.push(`${id}@${version} is missing ${requiredEntryFiles[resource.type]}`);
      } else if (!entryFile.content.trim()) {
        issues.push(`${id}@${version} has an empty ${entryFile.path}`);
      }
    } catch (error) {
      if (isMissingPathError(error)) {
        issues.push(`Resource version not found: ${id}@${version}`);
      } else {
        issues.push(`Could not read resource version: ${id}@${version}`);
      }
    }
  }

  return { resourceCount: index.resources.length, issues };
}

function resourceDirectory(
  registryRoot: string,
  resource: ResourceSummary,
  version: string,
): string {
  return join(
    registryRoot,
    'resources',
    resource.owner,
    resource.type,
    resource.name,
    version,
  );
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
