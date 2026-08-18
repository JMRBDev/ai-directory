import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  configuredPath,
  getScopeInstallManifestPath,
  isMissingPathError,
  isPathExistsError,
  pathExists,
  writeFileAtomic,
  type ConfigScope,
} from '@ai-directory/config';
export { isMissingPathError, pathExists } from '@ai-directory/config';
import { resourceKey } from '@ai-directory/contracts';
import type { ResourceVersion } from '@ai-directory/registry';
import { applyEdits, modify, parse } from 'jsonc-parser';
import { z } from 'zod';
import {
  resolveHarnessPaths,
  type Harness,
} from './harnesses.js';

export type {
  Harness,
  HarnessDefinition,
  HarnessDetection,
  HarnessLocation,
  HarnessPathContext,
  HarnessPathOptions,
} from './harnesses.js';

export type InstallOptions = {
  cwd?: string;
  homeDirectory?: string;
  force?: boolean;
  dryRun?: boolean;
  scope?: ConfigScope;
  environment?: NodeJS.ProcessEnv;
};

export type InstallResult = {
  destination: string;
  files: string[];
  skippedFiles: string[];
  paths: string[];
  ownedPaths: string[];
  fileHashes: Record<string, string>;
  changes?: InstallChange[];
};

export type InstallChange = {
  path: string;
  content: string | null;
};

export interface ResourceOperation {
  resource: string;
  harnesses: Harness[];
  action: 'install' | 'uninstall';
  version?: string;
  resources?: ResourceVersion[];
  resourceIds?: string[];
  warningResources?: ResourceVersion[];
}

export type PlannedResourceChange = {
  path: string;
  action: 'added' | 'modified' | 'removed';
  resource: string;
  harness: Harness;
  before?: string;
  after?: string;
};

export type ResourceChangePlan = {
  operations: ResourceOperation[];
  changes: PlannedResourceChange[];
  conflicts: string[];
  warnings: string[];
  projectionNotes: string[];
  fingerprint: string;
};

export type ResourceChangeOptions = Pick<
  InstallOptions,
  'cwd' | 'homeDirectory' | 'environment' | 'scope'
>;

export type ResourceApplyResult = {
  plan: ResourceChangePlan;
  installed: InstallationRecord[];
  removed: InstallationRecord[];
  warnings: string[];
};

export const installationRecordSchema = z.object({
  resource: z.string().min(1),
  version: z.string().min(1),
  harness: z.enum(['claude-code', 'opencode', 'codex']),
  destination: z.string().min(1),
  files: z.array(z.string().min(1)),
  fileHashes: z.record(z.string(), z.string()).optional(),
  kind: z.enum(['files', 'mcp']).optional(),
  scope: z.enum(['user', 'project']).optional(),
  installedAt: z.string().min(1),
});

export type InstallationRecord = z.infer<typeof installationRecordSchema>;

export const installationManifestSchema = z.object({
  schemaVersion: z.literal(1),
  installations: z.array(installationRecordSchema),
});

export type InstallationManifest = z.infer<typeof installationManifestSchema>;

export type ResourceInstallationMode = 'native' | 'translated' | 'configured';

export type ResourceKind = Exclude<ResourceVersion['resource']['type'], 'templates'>;

export type HarnessAdapter = {
  harness: Harness;
  installation: 'native-filesystem';
  capabilities: Record<ResourceKind, ResourceInstallationMode>;
  install(resources: ResourceVersion[], options: InstallOptions): Promise<InstallResult[]>;
};

export function getHarnessAdapter(value: string): HarnessAdapter {
  if (value !== 'claude-code' && value !== 'opencode' && value !== 'codex') {
    throw new Error(`Unsupported harness: ${value}`);
  }

  return harnessAdapters[value];
}

export { getHarnessDefinition, getHarnessDefinitions } from './harnesses.js';
export { resolveHarnessPaths };
export { detectHarnesses } from './harnesses.js';
export { discoverLocalResources } from './discovery.js';
export { enrichLocalResources } from './discovery.js';
export type {
  LocalResource,
  LocalResourceRegistryState,
  LocalResourceState,
  ResourceDiscoveryOptions,
} from './discovery.js';
export * from './mcp.js';

export async function installClaudeCodeResources(
  resources: ResourceVersion[],
  options: InstallOptions,
): Promise<InstallResult[]> {
  if (resources.length === 0) {
    throw new Error('No resources to install.');
  }

  const root = claudeCodeInstallRoot(options);
  const plans = resources.map((resource) => createClaudeCodePlan(root, resource));

  await assertInstallPlansAvailable(plans, options);
  await writeInstallPlans(plans, options.dryRun ?? false);

  const fileHashes = await hashInstallPlans(plans);

  return plans.map((plan) => {
    const result: InstallResult = {
      destination: plan.destination,
      files: plan.files.map((file) => file.path),
      skippedFiles: plan.skippedFiles,
      paths: plan.files.map((file) => file.destination),
      ownedPaths: plan.files.map((file) => file.destination),
      fileHashes: selectHashes(plan.files.map((file) => file.destination), fileHashes),
    };
    if (options.dryRun) {
      result.changes = plan.files.map((file) => ({ path: file.destination, content: file.content }));
    }
    return result;
  });
}

export async function installOpenCodeResources(
  resources: ResourceVersion[],
  options: InstallOptions,
): Promise<InstallResult[]> {
  if (resources.length === 0) {
    throw new Error('No resources to install.');
  }

  const root = openCodeInstallRoot(options);
  const plans = resources.map((resource) => createOpenCodePlan(root, resource));
  const rules = plans.filter((plan) => plan.resource.resource.type === 'rules');
  const config = rules.length > 0
    ? await prepareOpenCodeInstructions(
        root,
        rules.map((plan) => plan.resource),
        options,
      )
    : undefined;

  await assertInstallPlansAvailable(plans, options);
  await writeInstallPlans(plans, options.dryRun ?? false);

  if (config && !options.dryRun) {
    await writeFileAtomic(config.path, config.content);
  }

  const fileHashes = await hashInstallPlans(plans);

  return plans.map((plan) => {
    const result: InstallResult = {
      destination: plan.destination,
      files: plan.files.map((file) => file.path),
      skippedFiles: plan.skippedFiles,
      paths: [
        ...plan.files.map((file) => file.destination),
        ...(plan.resource.resource.type === 'rules' && config ? [config.path] : []),
      ],
      ownedPaths: plan.files.map((file) => file.destination),
      fileHashes: selectHashes(plan.files.map((file) => file.destination), fileHashes),
    };
    if (options.dryRun) {
      result.changes = [
        ...plan.files.map((file) => ({ path: file.destination, content: file.content })),
        ...(plan.resource.resource.type === 'rules' && config
          ? [{ path: config.path, content: config.content }]
          : []),
      ];
    }
    return result;
  });
}

export async function installCodexResources(
  resources: ResourceVersion[],
  options: InstallOptions,
): Promise<InstallResult[]> {
  if (resources.length === 0) {
    throw new Error('No resources to install.');
  }

  const paths = codexInstallPaths(options);
  const plans = resources.map((resource) => createCodexPlan(paths, resource));
  const rules = plans.filter((plan) => plan.resource.resource.type === 'rules');
  const guidance = rules.length > 0
    ? await prepareCodexGuidance(paths.guidanceRoot, rules, options.force ?? false)
    : undefined;

  await assertInstallPlansAvailable(plans, options);
  await writeInstallPlans(plans, options.dryRun ?? false);

  if (guidance && !options.dryRun) {
    await writeFileAtomic(guidance.path, guidance.content);
  }

  const fileHashes = await hashInstallPlans(plans);

  return plans.map((plan) => {
    const result: InstallResult = {
      destination:
        plan.resource.resource.type === 'rules' && guidance
          ? guidance.path
          : plan.destination,
      files: plan.files.map((file) => file.path),
      skippedFiles: plan.skippedFiles,
      paths: [
        ...plan.files.map((file) => file.destination),
        ...(plan.resource.resource.type === 'rules' && guidance ? [guidance.path] : []),
      ],
      ownedPaths: plan.files.map((file) => file.destination),
      fileHashes: selectHashes(plan.files.map((file) => file.destination), fileHashes),
    };
    if (options.dryRun) {
      result.changes = [
        ...plan.files.map((file) => ({ path: file.destination, content: file.content })),
        ...(plan.resource.resource.type === 'rules' && guidance
          ? [{ path: guidance.path, content: guidance.content }]
          : []),
      ];
    }
    return result;
  });
}

async function assertInstallPlansAvailable(
  plans: InstallPlan[],
  options: InstallOptions,
): Promise<void> {
  const destinations = new Set<string>();
  const overlaps: string[] = [];
  const existing: string[] = [];

  for (const plan of plans) {
    for (const file of plan.files) {
      const label = `${resourceKey(plan.resource.resource)} (${file.destination})`;

      if (destinations.has(file.destination)) {
        overlaps.push(label);
      }

      destinations.add(file.destination);

      if (!options.dryRun && !options.force && (await pathExists(file.destination))) {
        existing.push(label);
      }
    }
  }

  if (overlaps.length > 0) {
    throw new Error(`Install resources overlap at: ${overlaps.join(', ')}.`);
  }

  if (existing.length > 0) {
    throw new Error(
      `Install destinations are not available: ${existing.join(', ')}. Use --force to overwrite.`,
    );
  }
}

async function writeInstallPlans(plans: InstallPlan[], dryRun: boolean): Promise<void> {
  if (dryRun) return;

  for (const plan of plans) {
    for (const file of plan.files) {
      await writeFileAtomic(file.destination, file.content);
    }
  }
}

async function hashInstallPlans(plans: InstallPlan[]): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};

  for (const plan of plans) {
    for (const file of plan.files) {
      hashes[file.destination] = hashContent(file.content);
    }
  }

  return hashes;
}

function selectHashes(
  paths: string[],
  hashes: Record<string, string>,
) {
  const selected: Record<string, string> = {};

  for (const path of paths) {
    const hash = hashes[path];
    if (hash) selected[path] = hash;
  }

  return selected;
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function hashFile(path: string): Promise<string | null> {
  try {
    return hashContent(await readFile(path, 'utf8'));
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
}

const claudeCodeInstaller: HarnessAdapter = {
  harness: 'claude-code',
  installation: 'native-filesystem',
  capabilities: { skills: 'native', agents: 'native', rules: 'native', 'mcp-servers': 'configured' },
  install: installClaudeCodeResources,
};

export const openCodeInstaller: HarnessAdapter = {
  harness: 'opencode',
  installation: 'native-filesystem',
  capabilities: { skills: 'native', agents: 'translated', rules: 'configured', 'mcp-servers': 'configured' },
  install: installOpenCodeResources,
};

const codexInstaller: HarnessAdapter = {
  harness: 'codex',
  installation: 'native-filesystem',
  capabilities: { skills: 'native', agents: 'translated', rules: 'configured', 'mcp-servers': 'configured' },
  install: installCodexResources,
};

const harnessAdapters = {
  'claude-code': claudeCodeInstaller,
  opencode: openCodeInstaller,
  codex: codexInstaller,
} satisfies Record<Harness, HarnessAdapter>;

export async function readInstallationManifest(path: string): Promise<InstallationManifest> {
  let data: unknown;

  try {
    data = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (isMissingPathError(error)) return { schemaVersion: 1, installations: [] };
    throw new Error(`Installation manifest is not valid JSON: ${path}`, { cause: error });
  }

  const result = installationManifestSchema.safeParse(data);

  if (!result.success) {
    throw new Error(`Installation manifest is invalid: ${path}`);
  }

  return result.data;
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

export function createInstallationRecords(
  resources: ResourceVersion[],
  installations: InstallResult[],
  harness: Harness,
): InstallationRecord[] {
  const installedAt = new Date().toISOString();

  return resources.map((resource, index) => {
    const installation = installations[index];

    if (!installation) {
      throw new Error(`Installation result missing for ${resourceKey(resource.resource)}.`);
    }

    return {
      resource: resourceKey(resource.resource),
      version: resource.version,
      harness,
      destination: installation.destination,
      files: installation.ownedPaths,
      fileHashes: installation.fileHashes,
      installedAt,
    };
  });
}

async function saveInstallationRecords(
  path: string,
  records: InstallationRecord[],
  options: InstallOptions,
): Promise<InstallationManifest> {
  const current = await readInstallationManifest(path);
  const keys = new Set(records.map(installationKey));
  const previous = current.installations.filter((record) => keys.has(installationKey(record)));

  await removeStaleInstallationFiles(
    previous,
    records.flatMap((record) => record.files),
    options,
  );

  return updateInstallationManifest(path, records);
}

export async function removeInstallationRecord(
  path: string,
  target: InstallationRecord,
): Promise<InstallationManifest> {
  return rewriteInstallationManifest(path, (current) =>
    current.filter((record) => installationKey(record) !== installationKey(target)),
  );
}

async function rewriteInstallationManifest(
  path: string,
  select: (records: InstallationRecord[]) => InstallationRecord[],
): Promise<InstallationManifest> {
  const current = await readInstallationManifest(path);
  const manifest = {
    schemaVersion: 1 as const,
    installations: select(current.installations),
  };

  await writeFileAtomic(path, `${JSON.stringify(manifest, null, 2)}\n`);

  return manifest;
}

async function assertInstallationFilesUnchanged(
  record: InstallationRecord,
  force = false,
): Promise<void> {
  if (force) return;

  if (!record.fileHashes) {
    throw new Error(
      `Installation ${record.resource} has no ownership hashes. Reinstall it with --force before updating or uninstalling.`,
    );
  }

  const changed: string[] = [];

  for (const path of record.files) {
    const expected = record.fileHashes[path];

    if (!expected) {
      changed.push(path);
      continue;
    }

    const actual = await hashFile(path);
    if (actual !== null && actual !== expected) changed.push(path);
  }

  if (changed.length > 0) {
    throw new Error(
      `Installation files were modified: ${changed.join(', ')}. Use --force to continue.`,
    );
  }
}

export async function uninstallInstallation(
  record: InstallationRecord,
  options: InstallOptions,
): Promise<InstallChange[]> {
  const files = await ownedInstallationFiles(record, options);
  const normalized: InstallationRecord = {
    ...record,
    files,
  };
  if (record.fileHashes) {
    normalized.fileHashes = selectHashes(files, record.fileHashes);
  }

  await assertInstallationFilesUnchanged(normalized, options.force ?? false);
  const sharedChanges = await removeSharedConfiguration(record, options);

  if (!options.dryRun) {
    for (const change of sharedChanges) {
      if (change.content !== null) await writeFileAtomic(change.path, change.content);
    }
    await Promise.all(files.map((path) => rm(path, { force: true })));
  }

  return [
    ...sharedChanges,
    ...files.map((path) => ({ path, content: null })),
  ];
}

export async function planResourceOperations(
  operations: ResourceOperation[],
  options: ResourceChangeOptions = {},
  force = false,
): Promise<ResourceChangePlan> {
  const changes: PlannedResourceChange[] = [];
  const conflicts: string[] = [];
  const warnings: string[] = [];
  const projectionNotes: string[] = [];
  const contents = new Map<string, string | null>();

  async function addChange(
    change: InstallChange,
    operation: ResourceOperation,
    resource: string,
    harness: Harness,
  ) {
    const before = contents.has(change.path)
      ? contents.get(change.path) ?? null
      : await currentFile(change.path);
    contents.set(change.path, before);
    const action = classifyChange(before, change.content);
    if (!action) return;

    const existing = changes.find((item) => item.path === change.path);
    if (existing) {
      if (existing.after !== previewContent(change.content)) {
        conflicts.push(`Multiple changes target ${change.path}.`);
      }
      return;
    }

    const planned: PlannedResourceChange = {
      path: change.path,
      action,
      resource,
      harness,
    };
    const beforePreview = previewContent(before);
    const afterPreview = previewContent(change.content);
    if (beforePreview !== undefined) planned.before = beforePreview;
    if (afterPreview !== undefined) planned.after = afterPreview;
    changes.push(planned);
  }

  const installGroups = new Map<string, {
    resources: ResourceVersion[];
    owners: Map<string, ResourceOperation>;
  }>();

  for (const operation of operations) {
    if (operation.action !== 'install') continue;
    if (!operation.resources || operation.resources.length === 0) {
      throw new Error(`Install operation has no resources: ${operation.resource}.`);
    }

    for (const harness of operation.harnesses) {
      const group = installGroups.get(harness) ?? {
        resources: [],
        owners: new Map<string, ResourceOperation>(),
      };
      for (const resource of operation.resources) {
        const id = resourceKey(resource.resource);
        if (!group.owners.has(id)) {
          group.resources.push(resource);
          group.owners.set(id, operation);
        }
      }
      installGroups.set(harness, group);
    }
  }

  const processedInstallGroups = new Set<string>();

  for (const operation of operations) {
    const resourceIds = operation.resourceIds ?? operation.resources?.map((item) => resourceKey(item.resource)) ?? [];
    warnings.push(...requestWarnings(operation.warningResources ?? operation.resources ?? []));
    const manifestPath = installationManifestPath(options);
    const manifest = await readInstallationManifest(manifestPath);

    for (const harness of operation.harnesses) {
      const records = manifest.installations.filter(
        (record) =>
          record.harness === harness &&
          resourceIds.includes(record.resource),
      );

      for (const record of records) {
        try {
          await assertInstallationFilesUnchanged(record, force);
        } catch (error) {
          conflicts.push(`${record.resource} (${harness}): ${errorMessage(error)}`);
        }
      }

      if (operation.action === 'install') {
        if (processedInstallGroups.has(harness)) continue;
        processedInstallGroups.add(harness);
        const group = installGroups.get(harness);
        const resources = group?.resources ?? operation.resources ?? [];
        const installer = getHarnessAdapter(harness);
        const results = await installer.install(
          resources,
          operationInstallOptions(options, true, true),
        );

        for (const [index, result] of results.entries()) {
          const plannedResource = resources[index];
          const resourceId = plannedResource ? resourceKey(plannedResource.resource) : operation.resource;
          const owner = group?.owners.get(resourceId) ?? operation;
          if (!force) {
            const ownedByInstallation = new Set(
              manifest.installations
                .filter((record) => record.harness === harness)
                .flatMap((record) => record.files),
            );
            for (const path of result.ownedPaths) {
              if (ownedByInstallation.has(path) || (await currentFile(path)) === null) continue;
              conflicts.push(`Install destination is already occupied: ${path}. Use --force to overwrite.`);
            }
          }
          for (const change of result.changes ?? []) {
            await addChange(change, owner, resourceId, harness);
          }
          if (result.skippedFiles.length > 0) {
            projectionNotes.push(
              `${resourceId} · ${harness}: omitted harness-specific files (${result.skippedFiles.join(', ')}).`,
            );
          }

          const previous = manifest.installations.find(
            (record) =>
              record.resource === resourceId &&
              record.harness === harness,
          );
          if (previous) {
            const currentPaths = new Set(result.ownedPaths);
            for (const path of previous.files) {
              if (!currentPaths.has(path)) {
                await addChange({ path, content: null }, owner, resourceId, harness);
              }
            }
          }
        }
      } else {
        for (const record of records) {
          const result = await uninstallInstallation(
            record,
            operationInstallOptions(options, force, true),
          );
          for (const change of result) {
            await addChange(change, operation, record.resource, harness);
          }
        }
      }
    }
  }

  return {
    operations: operations.map(publicOperation),
    changes,
    conflicts: [...new Set(conflicts)],
    warnings: [...new Set(warnings)],
    projectionNotes: [...new Set(projectionNotes)],
    fingerprint: await fingerprintPaths(resourcePlanPaths(operations, changes, options)),
  };
}

export async function applyResourceOperations(
  operations: ResourceOperation[],
  options: ResourceChangeOptions = {},
  force = false,
  planned?: ResourceChangePlan,
): Promise<ResourceApplyResult> {
  return applyChangePlanEnvelope(
    operations,
    options,
    force,
    planned,
    () => planResourceOperations(operations, options, force),
    (plan) => resourcePlanPaths(operations, plan.changes, options),
    async (plan) => {
      const installed: InstallationRecord[] = [];
      const removed: InstallationRecord[] = [];
      const warnings = [...plan.warnings];

      for (const operation of operations) {
        try {
          const manifestPath = installationManifestPath(options);
          if (operation.action === 'install') {
            const resources = operation.resources ?? [];
            for (const harness of operation.harnesses) {
              const installer = getHarnessAdapter(harness);
              const installations = await installer.install(
                resources,
                operationInstallOptions(options, true),
              );
              const records = createInstallationRecords(resources, installations, installer.harness);
              await saveInstallationRecords(
                manifestPath,
                records,
                operationInstallOptions(options, force),
              );
              installed.push(...records);
            }
          } else {
            const resourceIds = operation.resourceIds ?? operation.resources?.map((item) => resourceKey(item.resource)) ?? [];
            const manifest = await readInstallationManifest(manifestPath);
            const records = manifest.installations.filter(
              (record) =>
                operation.harnesses.includes(record.harness) &&
                resourceIds.includes(record.resource),
            );

            for (const record of records) {
              await uninstallInstallation(
                record,
                operationInstallOptions(options, force),
              );
              await removeInstallationRecord(manifestPath, record);
              removed.push(record);
            }
          }
        } catch (error) {
          throw new Error(
            `Failed to ${operation.action} ${operation.resource} for ${operation.harnesses.join(', ')}: ${errorMessage(error)}`,
            { cause: error },
          );
        }
      }

      return { plan, installed, removed, warnings: [...new Set(warnings)] };
    },
    'Installation failed',
  );
}

export async function applyChangePlanEnvelope<T, P extends { fingerprint: string; conflicts: string[] }>(
  operations: readonly unknown[],
  options: ResourceChangeOptions,
  force: boolean,
  planned: P | undefined,
  planOperations: () => Promise<P>,
  pathsFor: (plan: P) => string[],
  applyAction: (plan: P) => Promise<T>,
  rollbackPrefix: string,
): Promise<T> {
  return withInstallationLocks(operations, options, async () => {
    const plan = planned ?? await planOperations();
    if (planned) {
      const fingerprint = await fingerprintPaths(pathsFor(plan));
      if (fingerprint !== plan.fingerprint) {
        throw new Error('Change plan is outdated. Generate a new preview before applying.');
      }
    }
    if (plan.conflicts.length > 0 && !force) {
      throw new Error(`Change plan contains conflicts: ${plan.conflicts.join(' ')}`);
    }

    const snapshots = await snapshotFiles(pathsFor(plan));

    try {
      return await applyAction(plan);
    } catch (error) {
      try {
        await restoreFiles(snapshots);
      } catch (rollbackError) {
        throw new Error(
          `${rollbackPrefix}. Rollback failed; manual review may be required.\nRollback error: ${errorMessage(rollbackError)}\nOriginal error: ${errorMessage(error)}`,
          { cause: error },
        );
      }
      throw new Error(
        `${rollbackPrefix}. All changes were rolled back.\nCause: ${errorMessage(error)}`,
        { cause: error },
      );
    }
  });
}

export async function removeStaleInstallationFiles(
  previous: InstallationRecord[],
  currentFiles: string[],
  options?: InstallOptions,
): Promise<void> {
  const keep = new Set(currentFiles);

  for (const record of previous) {
    const files = await ownedInstallationFiles(record, options);
    const stale = files.filter((path) => !keep.has(path));

    if (stale.length === 0) continue;

    const staleRecord: InstallationRecord = {
      ...record,
      files: stale,
    };
    if (record.fileHashes) {
      staleRecord.fileHashes = selectHashes(stale, record.fileHashes);
    }

    await assertInstallationFilesUnchanged(staleRecord, options?.force ?? false);
    await Promise.all(stale.map((path) => rm(path, { force: true })));
  }
}

async function ownedInstallationFiles(
  record: InstallationRecord,
  options?: InstallOptions,
): Promise<string[]> {
  if (record.fileHashes) return record.files;

  const files = new Set(record.files);
  const type = resourceType(record.resource);

  if (type === 'rules' && record.harness === 'codex') {
    files.delete(record.destination);
  }

  if (type === 'rules' && record.harness === 'opencode') {
    const installOptions = options ?? {};
    const root = openCodeInstallRoot(installOptions);
    const configPath = await openCodeConfigPath(root, installOptions);
    files.delete(configPath);
  }

  return [...files];
}

async function removeSharedConfiguration(
  record: InstallationRecord,
  options: InstallOptions,
): Promise<InstallChange[]> {
  const type = resourceType(record.resource);

  if (type !== 'rules') return [];

  if (record.harness === 'opencode') {
    const change = await removeOpenCodeInstruction(record, options);
    return change ? [change] : [];
  } else if (record.harness === 'codex') {
    const change = await removeCodexGuidance(record);
    return change ? [change] : [];
  }

  return [];
}

function readOpenCodeInstructions(current: string, path: string): string[] | undefined {
  const errors: Array<{ error: number; offset: number; length: number }> = [];
  const data = parse(current, errors);

  if (errors.length > 0) {
    throw new Error(`OpenCode config is not a valid object: ${path}`);
  }

  const result = openCodeConfigSchema.safeParse(data);

  if (!result.success) {
    const issue = result.error.issues[0];
    if (issue?.path[0] === 'instructions') {
      throw new Error(`OpenCode config instructions must be an array of strings: ${path}`);
    }
    throw new Error(`OpenCode config is not a valid object: ${path}`);
  }

  return result.data.instructions;
}

async function removeOpenCodeInstruction(
  record: InstallationRecord,
  options: InstallOptions,
): Promise<InstallChange | null> {
  const root = openCodeInstallRoot(options);
  const path = await openCodeConfigPath(root, options);
  const current = await currentFile(path);

  if (current === null) return null;

  const currentInstructions = readOpenCodeInstructions(current, path);
  if (!currentInstructions) return null;

  const entry = toPosixPath(relative(dirname(path), record.destination));
  if (!currentInstructions.includes(entry)) return null;

  return {
    path,
    content: applyEdits(
      current,
      modify(
        current,
        ['instructions'],
        currentInstructions.filter((value) => value !== entry),
        { formattingOptions: { insertSpaces: true, tabSize: 2 } },
      ),
    ),
  };
}

async function removeCodexGuidance(record: InstallationRecord): Promise<InstallChange | null> {
  const current = await currentFile(record.destination);

  if (current === null) return null;

  const key = record.resource;
  const startMarker = `<!-- ai-directory:rule:${key} -->`;
  const endMarker = `<!-- /ai-directory:rule:${key} -->`;
  const start = current.indexOf(startMarker);
  const end = current.indexOf(endMarker);

  if (start === -1 && end === -1) return null;

  if ((start === -1) !== (end === -1) || end < start) {
    throw new Error(`Codex managed rule block is malformed: ${key}`);
  }

  const before = current.slice(0, start);
  const after = current.slice(end + endMarker.length);
  const cleanedBefore = before.endsWith('\n\n') ? before.slice(0, -1) : before;
  const cleanedAfter = after.startsWith('\n') ? after.slice(1) : after;
  return {
    path: record.destination,
    content: `${cleanedBefore}${cleanedAfter}`,
  };
}

export function resourceType(resource: string): ResourceKind | undefined {
  const type = resource.split('/')[1];
  return type === 'skills' || type === 'agents' || type === 'rules'
    ? type
    : undefined;
}

function installationKey(record: InstallationRecord): string {
  return `${record.harness}:${record.resource}`;
}

const openCodeConfigSchema = z.object({
  instructions: z.array(z.string()).optional(),
});

type InstallPlan = {
  resource: ResourceVersion;
  destination: string;
  files: InstallFile[];
  skippedFiles: string[];
};

type InstallFile = {
  path: string;
  content: string;
  destination: string;
};

type PreparedText = {
  path: string;
  content: string;
};

type CodexInstallPaths = {
  root: string;
  codexHome: string;
  skillsRoot: string;
  guidanceRoot: string;
};

function createClaudeCodePlan(
  root: string,
  resource: ResourceVersion,
): InstallPlan {
  if (resource.resource.type === 'templates') {
    throw new Error(
      'Claude Code installation supports skills, agents, and rules. Templates must be expanded first.',
    );
  }

  const projection = projectFiles(resource, 'claude-code');
  const files = projection.files.map((file) => ({
    ...file,
    destination: destinationForFile(root, resource, file.path),
  }));

  return {
    resource,
    destination: resourceDestination(root, resource),
    files,
    skippedFiles: projection.skippedFiles,
  };
}

function createOpenCodePlan(
  root: string,
  resource: ResourceVersion,
): InstallPlan {
  if (resource.resource.type === 'templates') {
    throw new Error(
      'OpenCode installation supports skills, agents, and rules. Templates must be expanded first.',
    );
  }

  const projection = projectFiles(resource, 'opencode');
  const files = projection.files.map((file) => ({
    ...file,
    content:
      resource.resource.type === 'agents' && file.path === 'AGENT.md'
        ? openCodeAgentContent(resource)
        : file.content,
    destination: destinationForFile(root, resource, file.path),
  }));

  return {
    resource,
    destination: resourceDestination(root, resource),
    files,
    skippedFiles: projection.skippedFiles,
  };
}

function createCodexPlan(
  paths: CodexInstallPaths,
  resource: ResourceVersion,
): InstallPlan {
  if (resource.resource.type === 'templates') {
    throw new Error(
      'Codex installation supports skills, agents, and rules. Templates must be expanded first.',
    );
  }

  const projection = projectFiles(resource, 'codex');
  const files = projection.files.map((file) => ({
    ...file,
    content:
      resource.resource.type === 'agents' && file.path === 'AGENT.md'
        ? codexAgentContent(resource)
        : file.content,
    destination: codexDestinationForFile(paths, resource, file.path),
  }));

  return {
    resource,
    destination: codexResourceDestination(paths, resource),
    files,
    skippedFiles: projection.skippedFiles,
  };
}

function projectFiles(resource: ResourceVersion, harness: Harness) {
  const files = resource.files.filter((file) =>
    harness === 'codex' || file.path.replaceAll('\\', '/') !== 'agents/openai.yaml',
  );

  return {
    files,
    skippedFiles: resource.files
      .filter((file) => !files.includes(file))
      .map((file) => file.path),
  };
}

function destinationForFile(
  root: string,
  resource: ResourceVersion,
  resourcePath: string,
): string {
  const type = resource.resource.type;

  if (type === 'skills') {
    return safeDestination(resourceDestination(root, resource), resourcePath);
  }

  const directory = join(root, type);
  const entryFile = type === 'agents' ? 'AGENT.md' : 'RULE.md';

  if (resourcePath === entryFile) {
    return safeDestination(directory, `${resource.resource.name}.md`);
  }

  return safeDestination(
    join(directory, `${resource.resource.name}.files`),
    resourcePath,
  );
}

function claudeCodeInstallRoot(options: InstallOptions): string {
  return resolveHarnessPaths('claude-code', options).config;
}

function openCodeInstallRoot(options: InstallOptions): string {
  return resolveHarnessPaths('opencode', options).root;
}

function codexInstallPaths(options: InstallOptions): CodexInstallPaths {
  const location = resolveHarnessPaths('codex', options);

  return {
    root: location.root,
    codexHome: location.config,
    skillsRoot: location.skills,
    guidanceRoot: location.guidance,
  };
}

function resourceDestination(root: string, resource: ResourceVersion): string {
  if (resource.resource.type === 'skills') {
    return join(root, 'skills', resource.resource.name);
  }

  return join(root, resource.resource.type, `${resource.resource.name}.md`);
}

function codexDestinationForFile(
  paths: CodexInstallPaths,
  resource: ResourceVersion,
  resourcePath: string,
): string {
  if (resource.resource.type === 'skills') {
    return safeDestination(codexResourceDestination(paths, resource), resourcePath);
  }

  if (resource.resource.type === 'agents' && resourcePath === 'AGENT.md') {
    return safeDestination(join(paths.codexHome, 'agents'), `${resource.resource.name}.toml`);
  }

  if (resource.resource.type === 'rules' && resourcePath === 'RULE.md') {
    return safeDestination(join(paths.root, '.ai-directory', 'rules'), `${resource.resource.name}.md`);
  }

  const directory = resource.resource.type === 'agents'
    ? join(paths.codexHome, 'agents')
    : join(paths.root, '.ai-directory', 'rules');

  return safeDestination(
    join(directory, `${resource.resource.name}.files`),
    resourcePath,
  );
}

function codexResourceDestination(paths: CodexInstallPaths, resource: ResourceVersion): string {
  if (resource.resource.type === 'skills') {
    return join(paths.skillsRoot, resource.resource.name);
  }

  if (resource.resource.type === 'agents') {
    return join(paths.codexHome, 'agents', `${resource.resource.name}.toml`);
  }

  return join(paths.root, '.ai-directory', 'rules', `${resource.resource.name}.md`);
}

async function prepareOpenCodeInstructions(
  root: string,
  resources: ResourceVersion[],
  options: InstallOptions,
): Promise<PreparedText> {
  const path = await openCodeConfigPath(root, options);
  const entries = resources.map((resource) =>
    toPosixPath(relative(
      dirname(path),
      resourceDestination(root, resource),
    )),
  );
  const current = await currentFile(path);

  if (current === null) {
    return {
      path,
      content: `${JSON.stringify({ instructions: entries }, null, 2)}\n`,
    };
  }

  const currentInstructions = readOpenCodeInstructions(current, path);

  const instructions = currentInstructions === undefined
    ? []
    : [...currentInstructions];

  for (const entry of entries) {
    if (!instructions.includes(entry)) {
      instructions.push(entry);
    }
  }

  return {
    path,
    content: applyEdits(
      current,
      modify(current, ['instructions'], instructions, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      }),
    ),
  };
}

export async function pickOpenCodeConfig(candidates: string[]): Promise<string> {
  for (const path of candidates) {
    if (await pathExists(path)) {
      return path;
    }
  }

  return candidates[candidates.length - 1] ?? '';
}

async function openCodeConfigPath(
  root: string,
  options: InstallOptions,
): Promise<string> {
  const customPath = configuredPath(options.environment ?? process.env, 'OPENCODE_CONFIG');

  if (customPath) {
    return customPath;
  }

  return pickOpenCodeConfig([join(root, 'opencode.jsonc'), join(root, 'opencode.json')]);
}

async function prepareCodexGuidance(
  codexHome: string,
  plans: InstallPlan[],
  force: boolean,
): Promise<PreparedText> {
  const path = await codexGuidancePath(codexHome);
  let content = (await currentFile(path)) ?? '';

  for (const plan of plans) {
    content = upsertCodexRule(content, plan.resource, force);
  }

  return { path, content };
}

async function codexGuidancePath(codexHome: string): Promise<string> {
  const overridePath = join(codexHome, 'AGENTS.override.md');

  if (await pathExists(overridePath)) {
    return overridePath;
  }

  return join(codexHome, 'AGENTS.md');
}

function upsertCodexRule(
  contents: string,
  resource: ResourceVersion,
  force: boolean,
): string {
  const entry = resource.files.find((file) => file.path === 'RULE.md');

  if (!entry) {
    throw new Error(`Rule is missing RULE.md: ${resourceKey(resource.resource)}`);
  }

  const key = resourceKey(resource.resource);
  const startMarker = `<!-- ai-directory:rule:${key} -->`;
  const endMarker = `<!-- /ai-directory:rule:${key} -->`;
  const start = contents.indexOf(startMarker);
  const end = contents.indexOf(endMarker);

  if ((start === -1) !== (end === -1) || (start !== -1 && end < start)) {
    throw new Error(`Codex managed rule block is malformed: ${key}`);
  }

  const block = [
    startMarker,
    entry.content.endsWith('\n') ? entry.content : `${entry.content}\n`,
    endMarker,
  ].join('\n');

  if (start !== -1 && end !== -1) {
    if (!force) {
      throw new Error(`Codex rule is already installed: ${key}. Use --force to overwrite.`);
    }

    return `${contents.slice(0, start)}${block}${contents.slice(end + endMarker.length)}`;
  }

  const separator = contents.length === 0
    ? ''
    : contents.endsWith('\n')
      ? '\n'
      : '\n\n';

  return `${contents}${separator}${block}\n`;
}

function openCodeAgentContent(resource: ResourceVersion): string {
  const entry = resource.files.find((file) => file.path === 'AGENT.md');

  if (!entry) {
    throw new Error(`Agent is missing AGENT.md: ${resourceKey(resource.resource)}`);
  }

  return [
    '---',
    `description: ${JSON.stringify(resource.resource.description)}`,
    'mode: subagent',
    '---',
    '',
    entry.content,
  ].join('\n');
}

function codexAgentContent(resource: ResourceVersion): string {
  const entry = resource.files.find((file) => file.path === 'AGENT.md');

  if (!entry) {
    throw new Error(`Agent is missing AGENT.md: ${resourceKey(resource.resource)}`);
  }

  return [
    `name = ${JSON.stringify(resource.resource.name)}`,
    `description = ${JSON.stringify(resource.resource.description)}`,
    `developer_instructions = ${JSON.stringify(entry.content)}`,
    '',
  ].join('\n');
}

function safeDestination(root: string, resourcePath: string): string {
  const destination = resolve(root, resourcePath);
  const relativePath = relative(resolve(root), destination);

  if (!relativePath || isAbsolute(relativePath) || relativePath.startsWith('..')) {
    throw new Error(`Unsafe resource file path: ${resourcePath}`);
  }

  return destination;
}

export function publicOperation(operation: {
  resource: string;
  harnesses: Harness[];
  action: 'install' | 'uninstall';
  version?: string;
  scope?: ConfigScope;
}): typeof operation {
  const result: typeof operation = {
    resource: operation.resource,
    harnesses: operation.harnesses,
    action: operation.action,
  };
  if (operation.version !== undefined) result.version = operation.version;
  if (operation.scope !== undefined) result.scope = operation.scope;

  return result;
}

function operationInstallOptions(
  options: ResourceChangeOptions,
  force: boolean,
  dryRun = false,
): InstallOptions {
  const result: InstallOptions = { force, dryRun };
  if (options.cwd) result.cwd = options.cwd;
  if (options.homeDirectory) result.homeDirectory = options.homeDirectory;
  if (options.scope) result.scope = options.scope;
  if (options.environment) result.environment = options.environment;

  return result;
}

export type FileSnapshot = {
  path: string;
  content: string | null;
};

export async function snapshotFiles(paths: string[]): Promise<FileSnapshot[]> {
  const snapshots: FileSnapshot[] = [];

  for (const path of new Set(paths)) {
    snapshots.push({ path, content: await currentFile(path) });
  }

  return snapshots;
}

export async function restoreFiles(snapshots: FileSnapshot[]): Promise<void> {
  for (const snapshot of snapshots) {
    if (snapshot.content === null) {
      await rm(snapshot.path, { force: true });
    } else {
      await writeFileAtomic(snapshot.path, snapshot.content);
    }
  }
}

export async function currentFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
}

function previewContent(content: string | null): string | undefined {
  if (content === null) return undefined;
  const limit = 20_000;
  return content.length > limit ? `${content.slice(0, limit)}\n…` : content;
}

function classifyChange(
  before: string | null,
  after: string | null,
): PlannedResourceChange['action'] | null {
  if (after === null) return before === null ? null : 'removed';
  if (before === null) return 'added';
  return before === after ? null : 'modified';
}

export function requestWarnings(resources: ResourceVersion[]): string[] {
  return [...new Set(resources
    .filter((resource) => resource.resource.reviewStatus === 'unreviewed')
    .map((resource) => `${resourceKey(resource.resource)}@${resource.version}`))];
}

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function installationManifestPath(
  options: ResourceChangeOptions,
): string {
  return getScopeInstallManifestPath(
    options.scope ?? 'user',
    options.cwd,
    options.homeDirectory,
  );
}

function resourcePlanPaths(
  operations: ResourceOperation[],
  changes: PlannedResourceChange[],
  options: ResourceChangeOptions,
): string[] {
  return [
    ...changes.map((change) => change.path),
    ...operations.map(() => installationManifestPath(options)),
  ];
}

export async function fingerprintPaths(paths: string[]): Promise<string> {
  const state = [];

  for (const path of [...new Set(paths)].sort()) {
    state.push([path, await currentFile(path)] as const);
  }

  return createHash('sha256').update(JSON.stringify(state)).digest('hex');
}

type InstallationLock = {
  release(): Promise<void>;
};

type InstallationLockOwner = {
  pid: number;
  token: string;
};

const installationLockSchema = z.object({
  pid: z.number().int().positive(),
  token: z.string(),
});

export async function withInstallationLocks<T>(
  operations: readonly unknown[],
  options: ResourceChangeOptions,
  action: () => Promise<T>,
): Promise<T> {
  const lockPaths = [...new Set(
    operations.map(() =>
      `${resolve(installationManifestPath(options))}.lock`,
    ),
  )].sort();
  const locks: InstallationLock[] = [];

  let acquisitionError: unknown;
  try {
    for (const path of lockPaths) locks.push(await acquireInstallationLock(path));
  } catch (error) {
    acquisitionError = error;
  }

  if (acquisitionError !== undefined) {
    await releaseLocks(locks);
    throw acquisitionError;
  }

  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    const value = await action();
    outcome = { ok: true, value };
  } catch (error) {
    outcome = { ok: false, error };
  }

  const releaseError = await releaseLocks(locks);

  if (!outcome.ok) throw releaseError ?? outcome.error;
  if (releaseError) throw releaseError;
  return outcome.value;
}

async function releaseLocks(locks: InstallationLock[]): Promise<Error | undefined> {
  let releaseError: Error | undefined;
  for (const lock of locks.reverse()) {
    try {
      await lock.release();
    } catch (error) {
      releaseError ??= toError(error);
    }
  }
  return releaseError;
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

async function acquireInstallationLock(path: string): Promise<InstallationLock> {
  await mkdir(dirname(path), { recursive: true });
  const owner = { pid: process.pid, token: randomUUID() } satisfies InstallationLockOwner;
  const content = `${JSON.stringify(owner)}\n`;

  while (true) {
    try {
      const handle = await open(path, 'wx');
      try {
        await handle.writeFile(content, 'utf8');
      } catch (error) {
        await rm(path, { force: true });
        throw error;
      } finally {
        await handle.close();
      }

      return {
        release: async () => {
          if (await currentFile(path) === content) await rm(path, { force: true });
        },
      };
    } catch (error) {
      if (!isPathExistsError(error)) throw error;

      const existing = await readInstallationLock(path);
      if (!existing && !(await pathExists(path))) continue;
      if (!existing || isProcessRunning(existing.pid)) {
        throw new Error(`Another AI Directory installation is in progress: ${path}`);
      }

      await rm(path, { force: true });
    }
  }
}

async function readInstallationLock(path: string): Promise<InstallationLockOwner | null> {
  let content: string;

  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }

  try {
    const result = installationLockSchema.safeParse(JSON.parse(content));
    if (result.success) return { pid: result.data.pid, token: result.data.token };
  } catch {
    return null;
  }

  return null;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

function toPosixPath(path: string): string {
  return path.split(sep).join('/');
}
