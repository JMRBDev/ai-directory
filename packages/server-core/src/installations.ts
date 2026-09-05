import {
  getInstallManifestPath,
  getProjectInstallManifestPath,
  getScopeInstallManifestPath,
  type ConfigScope,
} from '@ai-directory/config';
import {
  assertInstalledFor,
  readInstallationManifest,
  type Harness,
  type InstallationManifest,
  type InstallationPackRecord,
  type InstallationRecord,
  type LocalResource,
  type McpOperation,
  type ResourceOperation,
  type ResourcePackOperation,
} from '@ai-directory/installers';
import { resourceKey } from '@ai-directory/contracts';
import {
  readRegistrySourceResource,
  type RegistrySource,
  type RemoteResourceResult,
} from '@ai-directory/registry';
import type { ServerOptions } from './types.js';

export async function readInstallationRecords(
  homeDirectory?: string,
  cwd?: string,
): Promise<InstallationRecord[]> {
  const manifests = await Promise.all([
    readInstallationManifest(getInstallManifestPath(homeDirectory)),
    readInstallationManifest(getProjectInstallManifestPath(cwd ?? process.cwd())),
  ]);

  return manifests.flatMap((manifest) => manifest.installations);
}

export async function readInstallationPacks(
  homeDirectory?: string,
  cwd?: string,
): Promise<InstallationPackRecord[]> {
  const manifests = await Promise.all([
    readInstallationManifest(getInstallManifestPath(homeDirectory)),
    readInstallationManifest(getProjectInstallManifestPath(cwd ?? process.cwd())),
  ]);

  return manifests.flatMap((manifest) => manifest.packs);
}

export function localResourceFromMcpRecord(record: InstallationRecord): LocalResource {
  const resource: LocalResource = {
    resource: record.resource,
    type: 'mcp-servers',
    name: record.resource.split('/').at(-1) ?? record.resource,
    harness: record.harness,
    path: record.destination,
    files: record.files,
    state: 'managed',
    registryState: 'unknown',
    version: record.version,
  };
  if (record.scope) resource.scope = record.scope;
  return resource;
}

export async function installationResourceIds(
  resource: string,
  source: RegistrySource | undefined,
  manifest?: InstallationManifest,
  harnesses?: Harness[],
): Promise<string[]> {
  if (!resource.includes('/templates/')) return [resource];

  const recorded = manifest?.packs.filter((pack) =>
    pack.resource === resource && (harnesses === undefined || harnesses.includes(pack.harness)),
  ) ?? [];
  if (recorded.length > 0) {
    return [...new Set(recorded.flatMap((pack) => pack.resources.map((entry) => entry.resource)))];
  }

  if (!source) {
    throw new Error('A registry source is required to inspect this template.');
  }

  const loaded = await readRegistrySourceResource(source, resource);
  return loaded.resources.map((item) => resourceKey(item.resource));
}

export function installationPackOperation(
  manifest: InstallationManifest,
  resource: string,
  harness: Harness,
): ResourcePackOperation | undefined {
  const record = manifest.packs.find((pack) =>
    pack.resource === resource && pack.harness === harness,
  );
  if (!record) return undefined;

  return {
    version: record.version,
    resources: record.resources,
  };
}

export function isMcpResource(resource: string): boolean {
  return resource.includes('/mcp-servers/');
}

export function resolveInstallScope(resource: string, scope?: ConfigScope): ConfigScope {
  return isMcpResource(resource) ? (scope ?? 'user') : 'user';
}

export function templatePackFor(loaded: RemoteResourceResult): ResourcePackOperation | undefined {
  if (loaded.resource.resource.type !== 'templates') return undefined;
  return {
    version: loaded.resource.version,
    resources: loaded.resources.map((entry) => ({
      resource: resourceKey(entry.resource),
      version: entry.version,
    })),
  };
}

export function makeFileInstallOperation(
  resource: string,
  harnesses: Harness[],
  loaded: RemoteResourceResult,
  version?: string,
): ResourceOperation {
  const operation: ResourceOperation = {
    resource,
    harnesses,
    action: 'install',
    resources: loaded.resources,
    warningResources: [loaded.resource, ...loaded.resources],
  };
  if (version !== undefined) operation.version = version;
  const pack = templatePackFor(loaded);
  if (pack) operation.pack = pack;
  return operation;
}

export function makeMcpInstallOperation(
  resource: string,
  harnesses: Harness[],
  scope: ConfigScope,
  loaded: RemoteResourceResult,
  version?: string,
): McpOperation {
  const operation: McpOperation = {
    resource,
    harnesses,
    action: 'install',
    resources: loaded.resources,
    warningResources: [loaded.resource, ...loaded.resources],
    scope,
  };
  if (version !== undefined) operation.version = version;
  return operation;
}

export async function makeFileUninstallOperations(
  resource: string,
  harnesses: Harness[],
  resourceIds: (resource: string, harness: Harness) => Promise<string[]> | string[],
  manifest: InstallationManifest,
): Promise<ResourceOperation[]> {
  const operations: ResourceOperation[] = [];
  for (const harness of harnesses) {
    const ids = await resourceIds(resource, harness);
    assertInstalledFor(manifest, ids, [harness], resource);
    const operation: ResourceOperation = {
      resource,
      harnesses: [harness],
      action: 'uninstall',
      resourceIds: ids,
    };
    const pack = installationPackOperation(manifest, resource, harness);
    if (pack) operation.pack = pack;
    operations.push(operation);
  }
  return operations;
}

export function installManifestPath(
  scope: ConfigScope,
  options: ServerOptions = {},
  cwd: string = process.cwd(),
): string {
  return getScopeInstallManifestPath(scope, cwd, options.homeDirectory);
}
