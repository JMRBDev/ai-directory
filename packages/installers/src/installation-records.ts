import { readFile } from 'node:fs/promises';
import {
  getScopeInstallManifestPath,
  isMissingPathError,
  writeFileAtomic,
} from '@ai-directory/config';
import { harnessSchema, resourceKey } from '@ai-directory/contracts';
import type { ResourceVersion } from '@ai-directory/registry';
import { z } from 'zod';
import {
  toolDependencyRemovalCandidates,
  type ToolDependencyRecord,
  type ToolDependencyRemovalCandidate,
} from './dependencies.js';
import type { Harness } from './harnesses.js';
import type { InstallResult } from './install-types.js';
import type { ResourceChangeOptions } from './resource-operation-types.js';

const sharedOwnershipSchema = z.object({
  path: z.string().min(1),
  key: z.string().min(1),
  hash: z.string().min(1),
  created: z.boolean().optional(),
});

export const installationRecordSchema = z.object({
  resource: z.string().min(1),
  version: z.string().min(1),
  harness: harnessSchema,
  destination: z.string().min(1),
  files: z.array(z.string().min(1)),
  fileHashes: z.record(z.string(), z.string()).optional(),
  shared: z.array(sharedOwnershipSchema).optional(),
  owners: z.array(z.string().min(1)).min(1).optional(),
  kind: z.enum(['files', 'mcp']).optional(),
  scope: z.enum(['user', 'project']).optional(),
  installedAt: z.string().min(1),
});

const installationPackEntrySchema = z.object({
  resource: z.string().min(1),
  version: z.string().min(1),
});

export const installationPackRecordSchema = z.object({
  resource: z.string().min(1),
  version: z.string().min(1),
  harness: harnessSchema,
  resources: z.array(installationPackEntrySchema).min(1),
  installedAt: z.string().min(1),
});

export type InstallationPackRecord = z.infer<typeof installationPackRecordSchema>;

const toolDependencyRecordSchema = z.object({
  resource: z.string().min(1),
  command: z.string().min(1),
  manager: z.enum(['homebrew', 'pipx', 'npm', 'cargo']),
  package: z.string().min(1),
  version: z.string().min(1).optional(),
  installedAt: z.string().min(1),
});

export type InstallationRecord = z.infer<typeof installationRecordSchema>;

export const installationManifestSchema = z.object({
  schemaVersion: z.literal(1),
  installations: z.array(installationRecordSchema),
  dependencies: z.array(toolDependencyRecordSchema).default([]),
  packs: z.array(installationPackRecordSchema).default([]),
});

export type InstallationManifest = {
  schemaVersion: 1;
  installations: InstallationRecord[];
  dependencies: ToolDependencyRecord[];
  packs: InstallationPackRecord[];
};

export async function readInstallationManifest(path: string): Promise<InstallationManifest> {
  let data: unknown;

  try {
    data = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (isMissingPathError(error)) {
      return { schemaVersion: 1, installations: [], dependencies: [], packs: [] };
    }
    throw new Error(`Installation manifest is not valid JSON: ${path}`, { cause: error });
  }

  const result = installationManifestSchema.safeParse(data);

  if (!result.success) {
    throw new Error(`Installation manifest is invalid: ${path}`);
  }

  const dependencies = result.data.dependencies.map((record) => {
    const dependency: ToolDependencyRecord = {
      resource: record.resource,
      command: record.command,
      manager: record.manager,
      package: record.package,
      installedAt: record.installedAt,
    };
    if (record.version !== undefined) dependency.version = record.version;
    return dependency;
  });

  return {
    schemaVersion: result.data.schemaVersion,
    installations: result.data.installations,
    dependencies,
    packs: result.data.packs,
  };
}

export function assertInstalledFor(
  manifest: InstallationManifest,
  resources: string[],
  harnesses: Harness[],
  resource: string,
): void {
  const missing = harnesses.filter((harness) =>
    resources.some(
      (id) =>
        !manifest.installations.some(
          (record) => record.resource === id && record.harness === harness,
        ),
    ),
  );

  if (missing.length > 0) {
    throw new Error(`${resource} is not installed for ${missing.join(', ')}.`);
  }
}

export async function updateInstallationManifest(
  path: string,
  records: InstallationRecord[],
): Promise<InstallationManifest> {
  const keys = new Set(records.map(installationKey));

  return rewriteInstallationManifest(path, (current) => [
    ...current.filter((record) => !keys.has(installationKey(record))),
    ...records,
  ]);
}

export async function updateInstallationPackRecords(
  path: string,
  records: InstallationPackRecord[],
): Promise<InstallationManifest> {
  const keys = new Set(records.map(installationKey));

  return rewriteFullInstallationManifest(path, (current) => ({
    ...current,
    packs: [
      ...current.packs.filter((record) => !keys.has(installationKey(record))),
      ...records,
    ],
  }));
}

export async function removeInstallationPackRecords(
  path: string,
  records: Array<Pick<InstallationPackRecord, 'resource' | 'harness'>>,
): Promise<InstallationManifest> {
  const keys = new Set(records.map(installationKey));

  return rewriteFullInstallationManifest(path, (current) => ({
    ...current,
    packs: current.packs.filter((record) => !keys.has(installationKey(record))),
  }));
}

export function createInstallationRecords(
  resources: ResourceVersion[],
  installations: InstallResult[],
  harness: Harness,
  owner?: string,
): InstallationRecord[] {
  const installedAt = new Date().toISOString();

  return resources.map((resource, index) => {
    const installation = installations[index];

    if (!installation) {
      throw new Error(`Installation result missing for ${resourceKey(resource.resource)}.`);
    }

    const record: InstallationRecord = {
      resource: resourceKey(resource.resource),
      version: resource.version,
      harness,
      destination: installation.destination,
      files: installation.ownedPaths,
      fileHashes: installation.fileHashes,
      owners: [owner ?? resourceKey(resource.resource)],
      installedAt,
    };
    if (installation.shared && installation.shared.length > 0) {
      record.shared = installation.shared;
    }
    return record;
  });
}

export async function removeInstallationRecord(
  path: string,
  target: InstallationRecord,
): Promise<InstallationManifest> {
  return rewriteInstallationManifest(path, (current) =>
    current.filter((record) => installationKey(record) !== installationKey(target)),
  );
}

export async function updateToolDependencyRecords(
  path: string,
  records: ToolDependencyRecord[],
): Promise<InstallationManifest> {
  const keys = new Set(records.map((record) => `${record.resource}\u0000${record.command}`));
  return rewriteFullInstallationManifest(path, (current) => ({
    ...current,
    dependencies: [
      ...current.dependencies.filter((record) => !keys.has(`${record.resource}\u0000${record.command}`)),
      ...records,
    ],
  }));
}

export async function removeToolDependencyRecords(
  path: string,
  resourceIds: string[],
): Promise<{ manifest: InstallationManifest; candidates: ToolDependencyRemovalCandidate[] }> {
  const current = await readInstallationManifest(path);
  const candidates = toolDependencyRemovalCandidates(current.dependencies, resourceIds);
  const removing = new Set(resourceIds);
  const manifest = await rewriteFullInstallationManifest(path, (latest) => ({
    ...latest,
    dependencies: latest.dependencies.filter((record) => !removing.has(record.resource)),
  }));
  return { manifest, candidates };
}

async function rewriteInstallationManifest(
  path: string,
  select: (records: InstallationRecord[]) => InstallationRecord[],
): Promise<InstallationManifest> {
  return rewriteFullInstallationManifest(path, (current) => ({
    ...current,
    installations: select(current.installations),
  }));
}

async function rewriteFullInstallationManifest(
  path: string,
  select: (manifest: InstallationManifest) => InstallationManifest,
): Promise<InstallationManifest> {
  const current = await readInstallationManifest(path);
  const manifest = select(current);

  await writeFileAtomic(path, `${JSON.stringify(manifest, null, 2)}\n`);

  return manifest;
}

export function installationKey(record: Pick<InstallationRecord, 'resource' | 'harness'>): string {
  return `${record.harness}:${record.resource}`;
}

export function installationOwners(record: InstallationRecord): string[] {
  return record.owners && record.owners.length > 0
    ? record.owners
    : [record.resource];
}

export function removeInstallationOwner(
  record: InstallationRecord,
  owner?: string,
): InstallationRecord | null {
  if (!owner) return null;

  const remaining = installationOwners(record).filter((value) => value !== owner);
  if (remaining.length === installationOwners(record).length) return record;
  if (remaining.length === 0) return null;
  return { ...record, owners: remaining };
}

export function willRemoveInstallation(record: InstallationRecord, owner?: string): boolean {
  return removeInstallationOwner(record, owner) === null;
}

export function installationManifestPath(
  options: ResourceChangeOptions,
): string {
  return getScopeInstallManifestPath(
    options.scope ?? 'user',
    options.cwd,
    options.homeDirectory,
  );
}
