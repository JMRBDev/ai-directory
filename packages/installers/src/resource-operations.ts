import { pathExists, type ConfigScope } from '@ai-directory/config';
import { resourceKey } from '@ai-directory/contracts';
import { readToolManifest, type ResourceVersion } from '@ai-directory/registry';
import { getHarnessAdapter } from './adapters.js';
import { applyChangePlanEnvelope } from './change-envelope.js';
import {
  installToolDependencies,
  restoreToolDependencies,
  toolDependencyRecordsForResources,
  toolDependencyRemovalCandidates,
  toolDependencyRemovalCandidatesForInstallResults,
  uninstallToolDependencies,
  type ToolDependencyInstallResult,
  type ToolDependencyOptions,
  type ToolDependencyUninstallResult,
} from './dependencies.js';
import { errorMessage } from './errors.js';
import { currentFile } from './file-snapshots.js';
import { fingerprintPaths } from './hashing.js';
import { assertInstallationFilesUnchanged, removeStaleInstallationFiles, uninstallInstallation } from './install-cleanup.js';
import type { Harness } from './harnesses.js';
import {
  createInstallationRecords,
  installationKey,
  installationManifestPath,
  installationOwners,
  readInstallationManifest,
  removeInstallationOwner,
  removeInstallationRecord,
  removeInstallationPackRecords,
  removeToolDependencyRecords,
  updateInstallationManifest,
  updateInstallationPackRecords,
  updateToolDependencyRecords,
  willRemoveInstallation,
  type InstallationManifest,
  type InstallationRecord,
} from './installation-records.js';
import type { InstallChange, InstallOptions, SharedOwnership } from './install-types.js';
import { pathsOverlap } from './paths.js';
import type {
  PlannedResourceChange,
  ResourceApplyResult,
  ResourceChangeOptions,
  ResourceChangePlan,
  ResourceOperation,
} from './resource-operation-types.js';

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

export function requestWarnings(resources: ResourceVersion[]): string[] {
  return [...new Set(resources
    .filter((resource) => resource.resource.reviewStatus === 'unreviewed')
    .map((resource) => `${resourceKey(resource.resource)}@${resource.version}`))];
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

function operationInstallOptions(
  options: ResourceChangeOptions,
  force: boolean,
  dryRun = false,
  installationOwner?: string,
): InstallOptions {
  const result: InstallOptions = { force, dryRun };
  if (options.cwd) result.cwd = options.cwd;
  if (options.homeDirectory) result.homeDirectory = options.homeDirectory;
  if (options.scope) result.scope = options.scope;
  if (options.environment) result.environment = options.environment;
  if (installationOwner) result.installationOwner = installationOwner;

  return result;
}

function dependencyOptionsFrom(options: ResourceChangeOptions): ToolDependencyOptions {
  const result: ToolDependencyOptions = {};
  if (options.cwd) result.cwd = options.cwd;
  if (options.environment) result.environment = options.environment;
  if (options.dependencyCommandRunner) result.commandRunner = options.dependencyCommandRunner;
  return result;
}

function mergeSharedOwnership(
  existing: SharedOwnership[] | undefined,
  incoming: SharedOwnership[] | undefined,
): SharedOwnership[] | undefined {
  if (!existing && !incoming) return undefined;

  const merged = new Map(
    (existing ?? []).map((ownership) => [`${ownership.path}:${ownership.key}`, ownership]),
  );
  for (const ownership of incoming ?? []) {
    merged.set(`${ownership.path}:${ownership.key}`, ownership);
  }

  return merged.size > 0 ? [...merged.values()] : undefined;
}

async function saveInstallationRecords(
  path: string,
  records: InstallationRecord[],
  options: InstallOptions,
): Promise<InstallationManifest> {
  const current = await readInstallationManifest(path);
  const keys = new Set(records.map(installationKey));
  const previous = current.installations.filter((record) => keys.has(installationKey(record)));
  const merged = records.map((record) => {
    const existing = previous.find((item) => installationKey(item) === installationKey(record));
    if (!existing) return record;

    return {
      ...record,
      shared: mergeSharedOwnership(existing.shared, record.shared),
      owners: [...new Set([...installationOwners(existing), ...installationOwners(record)])],
    };
  });

  await removeStaleInstallationFiles(
    previous,
    merged.flatMap((record) => record.files),
    options,
  );

  return updateInstallationManifest(path, merged);
}

function fullyRemovedResourceIds(
  operations: ResourceOperation[],
  installations: InstallationRecord[],
): string[] {
  const removedOwners = new Map<string, Set<string>>();
  for (const operation of operations.filter((item) => item.action === 'uninstall')) {
    const resourceIds = operation.resourceIds
      ?? operation.resources?.map((resource) => resourceKey(resource.resource))
      ?? [];
    for (const harness of operation.harnesses) {
      for (const resource of resourceIds) {
        const key = `${harness}:${resource}`;
        const owners = removedOwners.get(key) ?? new Set<string>();
        owners.add(operation.pack ? operation.resource : resource);
        removedOwners.set(key, owners);
      }
    }
  }

  const installedResourceIds = new Set(
    installations
      .filter((record) => {
        const owners = removedOwners.get(installationKey(record));
        return owners === undefined || installationOwners(record).some((owner) => !owners.has(owner));
      })
      .map((record) => record.resource),
  );
  const installingResourceIds = new Set(
    operations
      .filter((operation) => operation.action === 'install')
      .flatMap((operation) =>
        operation.resources?.map((resource) => resourceKey(resource.resource)) ?? [],
      ),
  );

  return [...new Set(
    operations
      .filter((operation) => operation.action === 'uninstall')
      .flatMap((operation) =>
        operation.resourceIds ?? operation.resources?.map((resource) => resourceKey(resource.resource)) ?? [],
      ),
  )].filter((resource) => !installedResourceIds.has(resource) && !installingResourceIds.has(resource));
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
  const processedPackStale = new Set<string>();

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
        if (operation.action === 'uninstall' && operation.pack && !willRemoveInstallation(record, operation.resource)) {
          continue;
        }
        try {
          await assertInstallationFilesUnchanged(record, force);
        } catch (error) {
          conflicts.push(`${record.resource} (${harness}): ${errorMessage(error)}`);
        }
      }

      if (operation.action === 'install') {
        if (operation.pack) {
          const staleKey = `${harness}:${operation.resource}`;
          const previousPack = manifest.packs.find((pack) =>
            pack.resource === operation.resource && pack.harness === harness,
          );
          if (previousPack && !processedPackStale.has(staleKey)) {
            processedPackStale.add(staleKey);
            const currentResources = new Set(
              operation.pack.resources.map((entry) => entry.resource),
            );
            const staleResources = new Set(
              previousPack.resources
                .map((entry) => entry.resource)
                .filter((resource) => !currentResources.has(resource)),
            );
            const staleRecords = manifest.installations.filter((record) =>
              record.harness === harness && staleResources.has(record.resource),
            );
            for (const record of staleRecords) {
              try {
                const staleChanges = await uninstallInstallation(
                  record,
                  operationInstallOptions(options, force, true, operation.resource),
                );
                for (const change of staleChanges) {
                  await addChange(change, operation, record.resource, harness);
                }
              } catch (error) {
                conflicts.push(`${record.resource} (${harness}): ${errorMessage(error)}`);
              }
            }
          }
        }
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
          const otherInstallations = manifest.installations.filter(
            (record) => record.harness === harness && record.resource !== resourceId,
          );
          const occupiedPaths = otherInstallations.flatMap((record) => [
            record.destination,
            ...record.files,
          ]);
          if (!force) {
            const resourceDestination = plannedResource?.resource.type === 'rules' && harness === 'codex'
              ? undefined
              : result.destination;
            const managedByCurrentResource = resourceDestination
              ? manifest.installations.some((record) =>
                  record.harness === harness
                  && record.resource === resourceId
                  && pathsOverlap(record.destination, resourceDestination),
                )
              : false;
            if (
              resourceDestination
              && (await pathExists(resourceDestination))
              && !managedByCurrentResource
            ) {
              conflicts.push(
                `Install destination is already occupied: ${resourceDestination}. Use --force to overwrite.`,
              );
            }
            for (const path of result.ownedPaths) {
              if (occupiedPaths.some((occupiedPath) => pathsOverlap(occupiedPath, path))) {
                conflicts.push(`Install destination is already occupied: ${path}. Use --force to overwrite.`);
                continue;
              }
              if ((await currentFile(path)) === null) continue;
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
          try {
            const result = await uninstallInstallation(
              record,
              operationInstallOptions(
                options,
                force,
                true,
                operation.pack ? operation.resource : undefined,
              ),
            );
            for (const change of result) {
              await addChange(change, operation, record.resource, harness);
            }
          } catch (error) {
            conflicts.push(`${record.resource} (${harness}): ${errorMessage(error)}`);
          }
        }
      }
    }
  }

  const manifest = await readInstallationManifest(installationManifestPath(options));
  const dependencyResourceIds = fullyRemovedResourceIds(operations, manifest.installations);
  const retainedDependencyCommands = operations
    .filter((operation) => operation.action === 'install')
    .flatMap((operation) => operation.resources ?? [])
    .flatMap((resource) => {
      if (resource.resource.type !== 'tools') return [];
      const manifest = readToolManifest(resource);
      return manifest.runtime
        ? [manifest.runtime.command, ...manifest.runtime.dependencies.map((dependency) => dependency.command)]
        : [];
    });
  const dependencyRemovals = dependencyResourceIds.length > 0
    ? toolDependencyRemovalCandidates(
        manifest.dependencies,
        dependencyResourceIds,
        retainedDependencyCommands,
      )
    : [];

  return {
    operations: operations.map(publicOperation),
    changes,
    conflicts: [...new Set(conflicts)],
    warnings: [...new Set(warnings)],
    projectionNotes: [...new Set(projectionNotes)],
    dependencyRemovals,
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
      const dependencyOptions = dependencyOptionsFrom(options);
      const installingResources = operations
        .filter((operation) => operation.action === 'install')
        .flatMap((operation) => operation.resources ?? []);
      const manifest = await readInstallationManifest(installationManifestPath(options));
      const removingResourceIds = fullyRemovedResourceIds(operations, manifest.installations);
      let dependencies: ToolDependencyInstallResult[] = [];
      let removedDependencies: ToolDependencyUninstallResult[] = [];

      try {
        dependencies = options.installDependencies && installingResources.length > 0
          ? await installToolDependencies(installingResources, dependencyOptions)
          : [];

        for (const operation of operations) {
          try {
            const manifestPath = installationManifestPath(options);
            if (operation.action === 'install') {
              const resources = operation.resources ?? [];
              for (const harness of operation.harnesses) {
                if (operation.pack) {
                  const currentManifest = await readInstallationManifest(manifestPath);
                  const previousPack = currentManifest.packs.find((pack) =>
                    pack.resource === operation.resource && pack.harness === harness,
                  );
                  if (previousPack) {
                    const currentResources = new Set(
                      operation.pack.resources.map((entry) => entry.resource),
                    );
                    const staleResources = new Set(
                      previousPack.resources
                        .map((entry) => entry.resource)
                        .filter((resource) => !currentResources.has(resource)),
                    );
                    const staleRecords = currentManifest.installations.filter((record) =>
                      record.harness === harness && staleResources.has(record.resource),
                    );
                    for (const record of staleRecords) {
                      const remaining = removeInstallationOwner(record, operation.resource);
                      if (remaining) {
                        await updateInstallationManifest(manifestPath, [remaining]);
                      } else {
                        await uninstallInstallation(
                          record,
                          operationInstallOptions(options, force, false, operation.resource),
                        );
                        await removeInstallationRecord(manifestPath, record);
                        removed.push(record);
                      }
                    }
                  }
                }
                const installer = getHarnessAdapter(harness);
                const installations = await installer.install(
                  resources,
                  operationInstallOptions(options, true),
                );
                const records = createInstallationRecords(
                  resources,
                  installations,
                  installer.harness,
                  operation.pack ? operation.resource : undefined,
                );
                const saved = await saveInstallationRecords(
                  manifestPath,
                  records,
                  operationInstallOptions(options, force),
                );
                installed.push(
                  ...records.map((record) =>
                    saved.installations.find((item) => installationKey(item) === installationKey(record)) ?? record,
                  ),
                );
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
                const owner = operation.pack ? operation.resource : record.resource;
                const remaining = removeInstallationOwner(record, owner);
                if (remaining) {
                  await updateInstallationManifest(manifestPath, [remaining]);
                  continue;
                }
                await uninstallInstallation(
                  record,
                  operationInstallOptions(options, force, false, owner),
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

        const manifestPath = installationManifestPath(options);
        if (installingResources.length > 0) {
          const manifest = await readInstallationManifest(manifestPath);
          const dependencyRecords = toolDependencyRecordsForResources(
            installingResources,
            dependencies,
            manifest.dependencies,
          );
          await updateToolDependencyRecords(manifestPath, dependencyRecords);
        }

        const installingPacks = operations
          .filter((operation) => operation.action === 'install' && operation.pack)
          .flatMap((operation) => operation.harnesses.map((harness) => ({
            resource: operation.resource,
            version: operation.pack?.version ?? operation.version ?? 'unknown',
            harness,
            resources: operation.pack?.resources ?? [],
            installedAt: new Date().toISOString(),
          })));
        if (installingPacks.length > 0) {
          await updateInstallationPackRecords(manifestPath, installingPacks);
        }

        if (removingResourceIds.length > 0) {
          if (options.removeDependencies && plan.dependencyRemovals.length > 0) {
            removedDependencies = await uninstallToolDependencies(
              plan.dependencyRemovals,
              dependencyOptions,
            );
          }
          await removeToolDependencyRecords(manifestPath, removingResourceIds);
        }

        const removingPacks = operations
          .filter((operation) => operation.action === 'uninstall' && operation.pack)
          .flatMap((operation) => operation.harnesses.map((harness) => ({
            resource: operation.resource,
            harness,
          })));
        if (removingPacks.length > 0) {
          await removeInstallationPackRecords(manifestPath, removingPacks);
        }

        return {
          plan,
          installed,
          removed,
          warnings: [...new Set(warnings)],
          dependencies,
          removedDependencies,
          dependencyRemovals: plan.dependencyRemovals,
        };
      } catch (error) {
        const rollbackErrors: string[] = [];

        try {
          const candidates = toolDependencyRemovalCandidatesForInstallResults(dependencies);
          if (candidates.length > 0) {
            await uninstallToolDependencies(candidates, dependencyOptions);
          }
        } catch (rollbackError) {
          rollbackErrors.push(`Dependency rollback failed: ${errorMessage(rollbackError)}`);
        }

        if (removedDependencies.length > 0) {
          try {
            await restoreToolDependencies(removedDependencies, dependencyOptions);
          } catch (rollbackError) {
            rollbackErrors.push(`Dependency restoration failed: ${errorMessage(rollbackError)}`);
          }
        }

        if (rollbackErrors.length > 0) {
          throw new Error(
            `${errorMessage(error)} ${rollbackErrors.join(' ')}`,
            { cause: error },
          );
        }
        throw error;
      }
    },
    'Installation failed',
  );
}
