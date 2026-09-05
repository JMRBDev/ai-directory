import { gte as isAtLeastVersion, valid as validVersion } from 'semver';
import type { ToolDependency, ToolInstaller } from '@ai-directory/contracts';
import { commandErrorMessage, runnerContext, versionOutputText, type ToolDependencyOptions } from './dependency-runner.js';
import { formatCommand, packageManagerDefinition } from './package-managers.js';

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

export function extractVersion(output: string): string | undefined {
  const candidates = output.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/gu) ?? [];

  for (const candidate of candidates) {
    const version = validVersion(candidate);
    if (version) return version;
  }

  return undefined;
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

export function mergeToolDependencies(first: ToolDependency, second: ToolDependency): ToolDependency {
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

export async function inspectToolDependency(
  resource: string,
  runtime: ToolDependency,
  options: ToolDependencyOptions,
): Promise<ToolDependencyStatus> {
  const { cwd, environment, runner } = runnerContext(options);
  let installed = false;
  let versionOutput: string | undefined;
  let failure: string | undefined;

  try {
    const result = await runner(runtime.command, ['--version'], cwd, environment);
    versionOutput = versionOutputText(result);
    installed = versionOutput.length > 0;
  } catch (error) {
    failure = commandErrorMessage(error);
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
      const definition = packageManagerDefinition(installer.manager);
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
  const { cwd, environment, runner } = runnerContext(options);

  for (const installer of installers) {
    const definition = packageManagerDefinition(installer.manager);

    try {
      await runner(definition.command, ['--version'], cwd, environment);
      available.push(installer);
    } catch {
      // Try the next supported package manager.
    }
  }

  return available;
}
