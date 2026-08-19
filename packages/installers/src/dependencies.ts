import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gte as isAtLeastVersion, valid as validVersion } from 'semver';
import {
  resourceKey,
  type ToolDependency,
  type ToolInstaller,
  type ToolPackageManager,
} from '@ai-directory/contracts';
import {
  readToolManifest,
  type ResourceVersion,
} from '@ai-directory/registry';

const execFileAsync = promisify(execFile);

export type DependencyCommandResult = {
  stdout: string;
  stderr: string;
};

export type DependencyCommandRunner = (
  command: string,
  args: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
) => Promise<DependencyCommandResult>;

export type ToolDependencyOptions = {
  cwd?: string;
  environment?: NodeJS.ProcessEnv;
  commandRunner?: DependencyCommandRunner;
};

export type ToolDependencyRecord = {
  resource: string;
  command: string;
  manager: ToolPackageManager;
  package: string;
  version?: string;
  installedAt: string;
};

export type ToolDependencyStatus = {
  resource: string;
  runtime: ToolDependency;
  installed: boolean;
  ready: boolean;
  version?: string;
  versionOutput?: string;
  failure?: string;
  availableInstallers: ToolInstaller[];
  installCommands: string[];
};

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

type PackageManagerDefinition = {
  command: string;
  installArgs(packageName: string): string[];
  upgradeArgs(packageName: string): string[];
  uninstallArgs(packageName: string): string[];
};

const packageManagers = {
  homebrew: {
    command: 'brew',
    installArgs: (packageName) => ['install', packageName],
    upgradeArgs: (packageName) => ['upgrade', packageName],
    uninstallArgs: (packageName) => ['uninstall', packageName],
  },
  pipx: {
    command: 'pipx',
    installArgs: (packageName) => ['install', packageName],
    upgradeArgs: (packageName) => ['upgrade', packageName],
    uninstallArgs: (packageName) => ['uninstall', packageName],
  },
  npm: {
    command: 'npm',
    installArgs: (packageName) => ['install', '--global', packageName],
    upgradeArgs: (packageName) => ['install', '--global', packageName],
    uninstallArgs: (packageName) => ['uninstall', '--global', packageName],
  },
  cargo: {
    command: 'cargo',
    installArgs: (packageName) => ['install', packageName],
    upgradeArgs: (packageName) => ['install', packageName],
    uninstallArgs: (packageName) => ['uninstall', packageName],
  },
} satisfies Record<ToolPackageManager, PackageManagerDefinition>;

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

    const definition = packageManagers[installer.manager];
    const args = status.installed
      ? definition.upgradeArgs(installer.package)
      : definition.installArgs(installer.package);
    const cwd = options.cwd ?? process.cwd();
    const environment = { ...process.env, ...options.environment };
    const runner = options.commandRunner ?? defaultCommandRunner;

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
        errorMessage(cause),
        { cause },
      );
    }

    const verified = await inspectToolDependency(status.resource, status.runtime, options);
    if (!verified.ready) {
      throw new Error(
        'Installed ' +
        status.runtime.command +
        ', but verification failed: ' +
        dependencyStatusMessage(verified),
      );
    }

    installed.push({
      resource: status.resource,
      manager: installer.manager,
      package: installer.package,
      command: definition.command,
      args,
      installedByPlatform: !status.installed,
      status: verified,
    });
  }

  return installed;
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
    const definition = packageManagers[first.manager];
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
  const cwd = options.cwd ?? process.cwd();
  const environment = { ...process.env, ...options.environment };
  const runner = options.commandRunner ?? defaultCommandRunner;
  const removed: ToolDependencyUninstallResult[] = [];

  for (const candidate of candidates) {
    const definition = packageManagers[candidate.manager];
    const args = definition.uninstallArgs(candidate.package);
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
        errorMessage(cause),
        { cause },
      );
    }

    try {
      const result = await runner(candidate.command, ['--version'], cwd, environment);
      if ((result.stdout + '\n' + result.stderr).trim()) {
        throw new Error(candidate.command + ' is still available after uninstall.');
      }
    } catch (error) {
      if (error instanceof Error && error.message.endsWith('is still available after uninstall.')) {
        throw error;
      }
    }

    removed.push({ candidate, command: definition.command, args });
  }

  return removed;
}

export function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(' ');
}

export function dependencyStatusMessage(status: ToolDependencyStatus): string {
  if (!status.installed) {
    return status.runtime.command + ' is not installed';
  }

  if (!status.version) {
    return status.runtime.command + ' did not report a semantic version';
  }

  if (status.runtime.minimumVersion) {
    return status.runtime.command + ' ' + status.version +
      ' is below the required minimum ' + status.runtime.minimumVersion;
  }

  return status.runtime.command + ' is not ready';
}

async function inspectToolDependency(
  resource: string,
  runtime: ToolDependency,
  options: ToolDependencyOptions,
): Promise<ToolDependencyStatus> {
  const cwd = options.cwd ?? process.cwd();
  const environment = { ...process.env, ...options.environment };
  const runner = options.commandRunner ?? defaultCommandRunner;
  let installed = false;
  let versionOutput: string | undefined;
  let failure: string | undefined;

  try {
    const result = await runner(runtime.command, ['--version'], cwd, environment);
    versionOutput = (result.stdout + '\n' + result.stderr).trim();
    installed = versionOutput.length > 0;
  } catch (error) {
    const cause = error instanceof Error ? error : String(error);
    failure = errorMessage(cause);
  }

  const version = versionOutput ? extractVersion(versionOutput) : undefined;
  const ready = installed &&
    version !== undefined &&
    (runtime.minimumVersion === undefined ||
      isAtLeastVersion(version, runtime.minimumVersion));
  const availableInstallers = await findAvailableInstallers(runtime.installers, options);

  const status: ToolDependencyStatus = {
    resource,
    runtime,
    installed,
    ready,
    availableInstallers,
    installCommands: runtime.installers.map((installer) => {
      const definition = packageManagers[installer.manager];
      return formatCommand(
        definition.command,
        installed
          ? definition.upgradeArgs(installer.package)
          : definition.installArgs(installer.package),
      );
    }),
  };

  if (version) status.version = version;
  if (versionOutput) status.versionOutput = versionOutput;
  if (failure) status.failure = failure;

  return status;
}

async function findAvailableInstallers(
  installers: ToolInstaller[],
  options: ToolDependencyOptions,
): Promise<ToolInstaller[]> {
  const available: ToolInstaller[] = [];
  const cwd = options.cwd ?? process.cwd();
  const environment = { ...process.env, ...options.environment };
  const runner = options.commandRunner ?? defaultCommandRunner;

  for (const installer of installers) {
    const definition = packageManagers[installer.manager];

    try {
      await runner(definition.command, ['--version'], cwd, environment);
      available.push(installer);
    } catch {
      // Try the next supported package manager.
    }
  }

  return available;
}

function mergeToolDependencies(first: ToolDependency, second: ToolDependency): ToolDependency {
  const minimumVersion = first.minimumVersion === undefined
    ? second.minimumVersion
    : second.minimumVersion === undefined
      ? first.minimumVersion
      : isAtLeastVersion(first.minimumVersion, second.minimumVersion)
        ? first.minimumVersion
        : second.minimumVersion;
  const installers = new Map<string, ToolInstaller>();
  for (const installer of [...first.installers, ...second.installers]) {
    installers.set(installer.manager + '\u0000' + installer.package, installer);
  }

  const merged: ToolDependency = {
    command: first.command,
    installers: [...installers.values()],
  };
  if (minimumVersion !== undefined) merged.minimumVersion = minimumVersion;
  return merged;
}

async function defaultCommandRunner(
  command: string,
  args: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
): Promise<DependencyCommandResult> {
  const result = await execFileAsync(command, args, {
    cwd,
    env: environment,
    encoding: 'utf8',
    maxBuffer: 1_000_000,
  });

  return {
    stdout: String(result.stdout),
    stderr: String(result.stderr),
  };
}

function extractVersion(output: string): string | undefined {
  const candidates = output.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/gu) ?? [];

  for (const candidate of candidates) {
    const version = validVersion(candidate);
    if (version) return version;
  }

  return undefined;
}

function errorMessage(error: Error | string): string {
  return error instanceof Error ? error.message : error;
}
