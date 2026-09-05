import {
  resourceKey,
  type ToolDependency,
  type ToolPackageManager,
} from '@ai-directory/contracts';
import { readToolManifest, type ResourceVersion } from '@ai-directory/registry';
import {
  commandErrorMessage,
  runnerContext,
  versionOutputText,
  type ToolDependencyOptions,
} from './dependency-runner.js';
import {
  dependencyStatusMessage,
  inspectToolDependency,
  mergeToolDependencies,
  type ToolDependencyStatus,
} from './dependency-inspect.js';
import { formatCommand, packageManagerDefinition } from './package-managers.js';

export type ToolDependencyInstallResult = {
  resource: string;
  manager: ToolPackageManager;
  package: string;
  command: string;
  args: string[];
  installedByPlatform: boolean;
  status: ToolDependencyStatus;
};

export type ToolDependencyRemovalCandidate = {
  command: string;
  manager: ToolPackageManager;
  package: string;
  version?: string;
  resources: string[];
  uninstallCommand: string;
};

export type ToolDependencyUninstallResult = {
  candidate: ToolDependencyRemovalCandidate;
  command: string;
  args: string[];
};

export type ToolDependencyRecord = {
  resource: string;
  command: string;
  manager: ToolPackageManager;
  package: string;
  version?: string;
  installedAt: string;
};

export async function inspectToolDependencies(
  resources: ResourceVersion[],
  options: ToolDependencyOptions = {},
): Promise<ToolDependencyStatus[]> {
  const dependencies = new Map<string, { resource: string; runtime: ToolDependency }>();

  for (const resource of resources) {
    if (resource.resource.type !== 'tools') continue;

    const id = resourceKey(resource.resource);
    const manifest = readToolManifest(resource);
    if (!manifest.runtime) continue;

    const runtimes = [manifest.runtime, ...manifest.runtime.dependencies];
    for (const runtime of runtimes) {
      const existing = dependencies.get(runtime.command);
      dependencies.set(
        runtime.command,
        existing
          ? { resource: existing.resource, runtime: mergeToolDependencies(existing.runtime, runtime) }
          : { resource: id, runtime },
      );
    }
  }

  return Promise.all(
    [...dependencies.values()].map(({ resource, runtime }) =>
      inspectToolDependency(resource, runtime, options),
    ),
  );
}

export async function installToolDependencies(
  resources: ResourceVersion[],
  options: ToolDependencyOptions = {},
): Promise<ToolDependencyInstallResult[]> {
  const statuses = await inspectToolDependencies(resources, options);
  const installed: ToolDependencyInstallResult[] = [];

  try {
    for (const status of statuses) {
      if (status.ready) continue;

      const installer = status.availableInstallers[0];
      if (!installer) {
        throw new Error(
          status.resource +
          ' requires ' +
          status.runtime.command +
          ', but no supported package manager is available. Install one of: ' +
          status.installCommands.join(', ') +
          '.',
        );
      }

      const definition = packageManagerDefinition(installer.manager);
      const args = status.installed
        ? definition.upgradeArgs(installer.package)
        : definition.installArgs(installer.package);
      const { cwd, environment, runner } = runnerContext(options);

      try {
        await runner(definition.command, args, cwd, environment);
      } catch (error) {
        const cause = error instanceof Error ? error : new Error(String(error));
        throw new Error(
          'Could not install ' +
          status.runtime.command +
          ' with ' +
          formatCommand(definition.command, args) +
          ': ' +
          commandErrorMessage(cause),
          { cause },
        );
      }

      const verified = await inspectToolDependency(status.resource, status.runtime, options);
      const result: ToolDependencyInstallResult = {
        resource: status.resource,
        manager: installer.manager,
        package: installer.package,
        command: definition.command,
        args,
        installedByPlatform: !status.installed,
        status: verified,
      };
      installed.push(result);

      if (!verified.ready) {
        throw new Error(
          'Installed ' +
          status.runtime.command +
          ', but verification failed: ' +
          dependencyStatusMessage(verified),
        );
      }
    }
  } catch (error) {
    try {
      await rollbackInstalledToolDependencies(installed, options);
    } catch (rollbackError) {
      throw new Error(
        `${commandErrorMessage(error)} Dependency rollback failed: ${commandErrorMessage(rollbackError)}`,
        { cause: error },
      );
    }
    throw error;
  }

  return installed;
}

export function toolDependencyRemovalCandidatesForInstallResults(
  results: ToolDependencyInstallResult[],
): ToolDependencyRemovalCandidate[] {
  return results
    .filter((result) => result.installedByPlatform)
    .map((result) => {
      const definition = packageManagerDefinition(result.manager);
      const candidate: ToolDependencyRemovalCandidate = {
        command: result.status.runtime.command,
        manager: result.manager,
        package: result.package,
        resources: [result.resource],
        uninstallCommand: formatCommand(
          definition.command,
          definition.uninstallArgs(result.package),
        ),
      };
      if (result.status.version) candidate.version = result.status.version;
      return candidate;
    });
}

export function toolDependencyRecordsForResources(
  resources: ResourceVersion[],
  installed: ToolDependencyInstallResult[],
  existing: ToolDependencyRecord[],
): ToolDependencyRecord[] {
  const installedByCommand = new Map(installed.map((result) => [result.status.runtime.command, result]));
  const existingByCommand = new Map(existing.map((record) => [record.command, record]));
  const records: ToolDependencyRecord[] = [];
  const seen = new Set<string>();

  for (const resource of resources) {
    if (resource.resource.type !== 'tools') continue;

    const resourceId = resourceKey(resource.resource);
    const manifest = readToolManifest(resource);
    if (!manifest.runtime) continue;

    for (const runtime of [manifest.runtime, ...manifest.runtime.dependencies]) {
      const key = resourceId + '\u0000' + runtime.command;
      if (seen.has(key)) continue;
      seen.add(key);

      const installedResult = installedByCommand.get(runtime.command);
      const existingRecord = existingByCommand.get(runtime.command);
      if (!installedResult?.installedByPlatform && !existingRecord) continue;

      const manager = installedResult?.manager ?? existingRecord?.manager;
      const packageName = installedResult?.package ?? existingRecord?.package;
      if (!manager || !packageName) continue;

      const version = installedResult?.status.version ?? existingRecord?.version;
      const record: ToolDependencyRecord = {
        resource: resourceId,
        command: runtime.command,
        manager,
        package: packageName,
        installedAt: existingRecord?.installedAt ?? new Date().toISOString(),
      };
      if (version) record.version = version;
      records.push(record);
    }
  }

  return records;
}

export function toolDependencyRemovalCandidates(
  records: ToolDependencyRecord[],
  removingResources: string[],
  retainedCommands: string[] = [],
): ToolDependencyRemovalCandidate[] {
  const removing = new Set(removingResources);
  const remainingCommands = new Set(
    records
      .filter((record) => !removing.has(record.resource))
      .map((record) => record.command),
  );
  for (const command of retainedCommands) remainingCommands.add(command);
  const grouped = new Map<string, ToolDependencyRecord[]>();

  for (const record of records) {
    if (!removing.has(record.resource) || remainingCommands.has(record.command)) continue;
    const group = grouped.get(record.command) ?? [];
    group.push(record);
    grouped.set(record.command, group);
  }

  return [...grouped.entries()].map(([command, group]) => {
    const first = group[0];
    if (!first) throw new Error(`Missing dependency record for ${command}.`);
    const definition = packageManagerDefinition(first.manager);
    const candidate: ToolDependencyRemovalCandidate = {
      command,
      manager: first.manager,
      package: first.package,
      resources: [...new Set(group.map((record) => record.resource))],
      uninstallCommand: formatCommand(
        definition.command,
        definition.uninstallArgs(first.package),
      ),
    };
    const version = group.find((record) => record.version)?.version;
    if (version) candidate.version = version;
    return candidate;
  });
}

export async function uninstallToolDependencies(
  candidates: ToolDependencyRemovalCandidate[],
  options: ToolDependencyOptions = {},
): Promise<ToolDependencyUninstallResult[]> {
  const { cwd, environment, runner } = runnerContext(options);
  const removed: ToolDependencyUninstallResult[] = [];

  let current: ToolDependencyUninstallResult | undefined;
  try {
    for (const candidate of candidates) {
      const definition = packageManagerDefinition(candidate.manager);
      const args = definition.uninstallArgs(candidate.package);
      current = { candidate, command: definition.command, args };
      try {
        await runner(definition.command, args, cwd, environment);
      } catch (error) {
        const cause = error instanceof Error ? error : new Error(String(error));
        throw new Error(
          'Could not uninstall ' +
          candidate.command +
          ' with ' +
          formatCommand(definition.command, args) +
          ': ' +
          commandErrorMessage(cause),
          { cause },
        );
      }

      try {
        const result = await runner(candidate.command, ['--version'], cwd, environment);
        if (versionOutputText(result)) {
          throw new Error(candidate.command + ' is still available after uninstall.');
        }
      } catch (error) {
        if (error instanceof Error && error.message.endsWith('is still available after uninstall.')) {
          throw error;
        }
      }

      removed.push(current);
      current = undefined;
    }
  } catch (error) {
    const completed = current ? [...removed, current] : removed;
    try {
      await restoreToolDependencies(completed, options);
    } catch (rollbackError) {
      throw new Error(
        `${commandErrorMessage(error)} Dependency restoration failed: ${commandErrorMessage(rollbackError)}`,
        { cause: error },
      );
    }
    throw error;
  }

  return removed;
}

export async function restoreToolDependencies(
  removed: ToolDependencyUninstallResult[],
  options: ToolDependencyOptions = {},
): Promise<void> {
  const { cwd, environment, runner } = runnerContext(options);

  for (const removal of [...removed].reverse()) {
    const definition = packageManagerDefinition(removal.candidate.manager);
    const args = definition.installArgs(removal.candidate.package);
    await runner(definition.command, args, cwd, environment);

    let result;
    try {
      result = await runner(removal.candidate.command, ['--version'], cwd, environment);
    } catch (error) {
      throw new Error(
        `Restored ${removal.candidate.command}, but verification failed: ${commandErrorMessage(error)}`,
        { cause: error },
      );
    }

    if (!versionOutputText(result)) {
      throw new Error(
        `Restored ${removal.candidate.command}, but verification returned no output.`,
      );
    }
  }
}

async function rollbackInstalledToolDependencies(
  installed: ToolDependencyInstallResult[],
  options: ToolDependencyOptions,
): Promise<void> {
  const candidates = toolDependencyRemovalCandidatesForInstallResults(installed);
  if (candidates.length === 0) return;
  await uninstallToolDependencies(candidates, options);
}
