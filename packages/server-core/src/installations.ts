import {
  getInstallManifestPath,
  getProjectInstallManifestPath,
  getScopeInstallManifestPath,
  type ConfigScope,
} from '@ai-directory/config';
import {
  readInstallationManifest,
  type Harness,
  type InstallationManifest,
  type InstallationPackRecord,
  type InstallationRecord,
  type LocalResource,
  type ResourcePackOperation,
} from '@ai-directory/installers';
import { resourceKey } from '@ai-directory/contracts';
import { readRegistrySourceResource, type RegistrySource } from '@ai-directory/registry';
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

export function installManifestPath(
  scope: ConfigScope,
  options: ServerOptions = {},
  cwd: string = process.cwd(),
): string {
  return getScopeInstallManifestPath(scope, cwd, options.homeDirectory);
}
