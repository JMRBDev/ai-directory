import { createHash } from 'node:crypto';
import { access, readdir, readFile } from 'node:fs/promises';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import type { RegistryIndex } from '@ai-directory/contracts';
import { resourceKey } from '@ai-directory/domain';
import { isResourceVersionOutdated } from '@ai-directory/registry';
import type { InstallationRecord, ResourceKind } from './index.js';
import {
  getHarnessDefinitions,
  resolveHarnessPaths,
  type Harness,
  type HarnessLocation,
  type HarnessPathOptions,
} from './harnesses.js';

export type LocalResourceState = 'managed' | 'modified' | 'missing' | 'unmanaged';
export type LocalResourceRegistryState = 'current' | 'outdated' | 'unknown';

export type LocalResource = {
  resource?: string;
  type: ResourceKind;
  name: string;
  harness: Harness;
  path: string;
  files: string[];
  state: LocalResourceState;
  registryState: LocalResourceRegistryState;
  version?: string;
  latestVersion?: string;
  scope?: 'user' | 'project';
};

export type ResourceDiscoveryOptions = HarnessPathOptions & {
  records?: readonly InstallationRecord[];
};

export async function discoverLocalResources(
  options: ResourceDiscoveryOptions = {},
): Promise<LocalResource[]> {
  const records = options.records ?? [];
  const fileRecords = records.filter((record) => record.kind !== 'mcp');
  const managed = await Promise.all(fileRecords.map(localResourceFromRecord));
  const managedRecords = records.filter((record) => resourceType(record.resource));
  const discovered: LocalResource[] = [];

  for (const definition of getHarnessDefinitions()) {
    const location = resolveHarnessPaths(definition.harness, options);
    const candidates = await scanLocation(definition.harness, location);

    discovered.push(
      ...candidates.filter(
        (candidate) => !matchesManagedRecord(candidate, managedRecords),
      ),
    );
  }

  return [...managed, ...discovered].sort((left, right) =>
    [left.type, left.name, left.harness, left.path]
      .join('\0')
      .localeCompare([right.type, right.name, right.harness, right.path].join('\0')),
  );
}

export function enrichLocalResources(
  resources: LocalResource[],
  index: RegistryIndex | null,
): LocalResource[] {
  return resources.map((resource) => {
    const summary = resource.resource && index?.resources.find(
      (candidate) => resourceKey(candidate) === resource.resource,
    );

    if (!summary || !resource.version) {
      return { ...resource, registryState: 'unknown' as const };
    }

    if (summary.latestVersion === resource.version) {
      return {
        ...resource,
        registryState: 'current' as const,
        latestVersion: summary.latestVersion,
      };
    }

    return {
      ...resource,
      registryState: isResourceVersionOutdated(resource.version, summary.latestVersion)
        ? 'outdated' as const
        : 'unknown' as const,
      latestVersion: summary.latestVersion,
    };
  });
}

async function localResourceFromRecord(record: InstallationRecord): Promise<LocalResource> {
  const type = resourceType(record.resource);
  if (!type) {
    throw new Error(`Unsupported installed resource type: ${record.resource}`);
  }

  const files = record.files.length > 0 ? record.files : [record.destination];
  let state: LocalResourceState = 'managed';

  for (const path of files) {
    if (!(await pathExists(path))) {
      state = 'missing';
      break;
    }

    const expected = record.fileHashes?.[path];
    if (expected && (await hashFile(path)) !== expected) state = 'modified';
  }

  return {
    resource: record.resource,
    type,
    name: resourceName(record.resource),
    harness: record.harness,
    path: record.destination,
    files,
    state,
    registryState: 'unknown',
    version: record.version,
  };
}

async function scanLocation(
  harness: Harness,
  location: HarnessLocation,
): Promise<LocalResource[]> {
  return [
    ...(await scanSkills(harness, location.skills)),
    ...(await scanFlatResources(harness, 'agents', location.agents, harness === 'codex' ? ['.toml', '.md'] : ['.md'])),
    ...(await scanFlatResources(harness, 'rules', location.rules, ['.md'])),
  ];
}

async function scanSkills(
  harness: Harness,
  root: string,
): Promise<LocalResource[]> {
  const entries = await readDirectory(root);
  const resources: LocalResource[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;

    const path = join(root, entry.name);
    const files = await filesUnder(path);
    if (!files.some((file) => relative(path, file) === 'SKILL.md')) continue;

    resources.push({
      type: 'skills',
      name: entry.name,
      harness,
      path,
      files,
      state: 'unmanaged',
      registryState: 'unknown',
    });
  }

  return resources;
}

async function scanFlatResources(
  harness: Harness,
  type: Exclude<ResourceKind, 'skills'>,
  root: string,
  extensions: string[],
): Promise<LocalResource[]> {
  const entries = await readDirectory(root);
  const resources: LocalResource[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !extensions.includes(extname(entry.name))) continue;

    const path = join(root, entry.name);
    const name = basename(entry.name, extname(entry.name));
    const companionPath = join(root, `${name}.files`);
    const files = [path, ...(await filesUnder(companionPath))];

    resources.push({
      type,
      name,
      harness,
      path,
      files,
      state: 'unmanaged',
      registryState: 'unknown',
    });
  }

  return resources;
}

function matchesManagedRecord(
  candidate: LocalResource,
  records: readonly InstallationRecord[],
): boolean {
  return records.some((record) => {
    if (record.harness !== candidate.harness) return false;

    const managedPaths = [record.destination, ...record.files].map((path) => resolve(path));
    return candidate.files.some((file) =>
      managedPaths.some((managedPath) => pathsOverlap(file, managedPath)),
    );
  });
}

function pathsOverlap(left: string, right: string): boolean {
  const first = resolve(left);
  const second = resolve(right);
  return first === second || first.startsWith(`${second}${sep}`) || second.startsWith(`${first}${sep}`);
}

function resourceType(resource: string): ResourceKind | undefined {
  const type = resource.split('/')[1];
  return type === 'skills' || type === 'agents' || type === 'rules' ? type : undefined;
}

function resourceName(resource: string): string {
  return resource.split('/').at(-1) ?? resource;
}

async function filesUnder(root: string): Promise<string[]> {
  const entries = await readDirectory(root);
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isFile()) files.push(path);
    else if (entry.isDirectory() && !entry.isSymbolicLink()) files.push(...await filesUnder(path));
  }

  return files;
}

async function readDirectory(path: string) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) return [];
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function hashFile(path: string): Promise<string | null> {
  try {
    return createHash('sha256').update(await readFile(path)).digest('hex');
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
}

function isMissingPathError(cause: unknown): boolean {
  return cause instanceof Object && 'code' in cause && cause.code === 'ENOENT';
}