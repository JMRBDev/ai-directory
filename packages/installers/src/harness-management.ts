import type { Harness, ToolInstaller, ToolPackageManager } from '@ai-directory/contracts';
import {
  defaultCommandRunner,
  formatCommand,
  inspectToolDependency,
  packageManagerDefinition,
  type DependencyCommandRunner,
  type DependencyCommandResult,
  type ToolDependencyOptions,
  type ToolDependencyStatus,
} from './dependencies.js';
import { errorMessage } from './errors.js';
import { getHarnessDefinition } from './harnesses.js';

export type HarnessManagementOptions = ToolDependencyOptions;

export type HarnessStatus = {
  harness: Harness;
  displayName: string;
  command: string;
  installed: boolean;
  availableInstallers: ToolInstaller[];
  installCommand: string;
  upgradeCommand: string;
  uninstallCommand: string;
  version?: string;
  versionOutput?: string;
  failure?: string;
};

export type HarnessActionResult = {
  harness: Harness;
  manager: ToolPackageManager;
  package: string;
  command: string;
  args: string[];
  version?: string;
};

function harnessRuntime(harness: Harness) {
  const definition = getHarnessDefinition(harness);
  return {
    command: definition.command,
    installers: definition.installers,
    displayName: definition.displayName,
  };
}

function preferredInstaller(status: ToolDependencyStatus, installers: ToolInstaller[]): ToolInstaller {
  const installer = status.availableInstallers[0] ?? installers[0];
  if (!installer) throw new Error(`No package manager recipe is configured for ${status.resource}.`);
  return installer;
}

async function inspectHarnessRuntime(
  harness: Harness,
  options: HarnessManagementOptions,
): Promise<{ status: ToolDependencyStatus; displayName: string; command: string; installers: ToolInstaller[] }> {
  const runtime = harnessRuntime(harness);
  const status = await inspectToolDependency(
    `harness/${harness}`,
    { command: runtime.command, installers: runtime.installers },
    options,
  );

  return { status, displayName: runtime.displayName, command: runtime.command, installers: runtime.installers };
}

function harnessStatus(
  harness: Harness,
  displayName: string,
  command: string,
  installers: ToolInstaller[],
  status: ToolDependencyStatus,
): HarnessStatus {
  const preferred = preferredInstaller(status, installers);
  const preferredDefinition = packageManagerDefinition(preferred.manager);
  const result: HarnessStatus = {
    harness,
    displayName,
    command,
    installed: status.installed,
    availableInstallers: status.availableInstallers,
    installCommand: formatCommand(preferredDefinition.command, preferredDefinition.installArgs(preferred.package)),
    upgradeCommand: formatCommand(preferredDefinition.command, preferredDefinition.upgradeArgs(preferred.package)),
    uninstallCommand: formatCommand(preferredDefinition.command, preferredDefinition.uninstallArgs(preferred.package)),
  };
  if (status.version) result.version = status.version;
  if (status.versionOutput) result.versionOutput = status.versionOutput;
  if (status.failure) result.failure = status.failure;

  return result;
}

export async function inspectHarness(harness: Harness, options: HarnessManagementOptions = {}): Promise<HarnessStatus> {
  const runtime = await inspectHarnessRuntime(harness, options);
  return harnessStatus(harness, runtime.displayName, runtime.command, runtime.installers, runtime.status);
}

export async function inspectHarnesses(options: HarnessManagementOptions = {}): Promise<HarnessStatus[]> {
  return Promise.all(
    (['claude-code', 'opencode', 'codex'] as const).map((harness) => inspectHarness(harness, options)),
  );
}

async function runManagerCommand(
  manager: ToolPackageManager,
  args: string[],
  options: HarnessManagementOptions,
): Promise<DependencyCommandResult> {
  const definition = packageManagerDefinition(manager);
  const runner: DependencyCommandRunner = options.commandRunner ?? defaultCommandRunner;
  const cwd = options.cwd ?? process.cwd();
  const environment = { ...process.env, ...options.environment };

  try {
    return await runner(definition.command, args, cwd, environment);
  } catch (error) {
    throw new Error(
      `Could not run ${formatCommand(definition.command, args)}: ${errorMessage(error instanceof Error ? error : String(error))}`,
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

async function verifyInstalled(harness: Harness, options: HarnessManagementOptions): Promise<HarnessStatus> {
  const runtime = await inspectHarnessRuntime(harness, options);
  if (!runtime.status.installed) {
    throw new Error(
      `Verified ${runtime.displayName}, but ${runtime.command} did not respond after the action.`,
    );
  }

  return harnessStatus(harness, runtime.displayName, runtime.command, runtime.installers, runtime.status);
}

export async function installHarness(harness: Harness, options: HarnessManagementOptions = {}): Promise<HarnessActionResult> {
  const runtime = await inspectHarnessRuntime(harness, options);
  if (runtime.status.installed) {
    throw new Error(
      `${runtime.displayName} is already installed${runtime.status.version ? ` (${runtime.status.version})` : ''}. Use a harness update to upgrade it.`,
    );
  }

  const installer = runtime.status.availableInstallers[0];
  if (!installer) {
    throw new Error(
      `No supported package manager is available to install ${runtime.displayName}. Install one of: ` +
      runtime.installers.map((candidate) => packageManagerDefinition(candidate.manager).command).join(', ') +
      '.',
    );
  }

  const args = packageManagerDefinition(installer.manager).installArgs(installer.package);
  await runManagerCommand(installer.manager, args, options);
  const verified = await verifyInstalled(harness, options);

  const result: HarnessActionResult = {
    harness,
    manager: installer.manager,
    package: installer.package,
    command: packageManagerDefinition(installer.manager).command,
    args,
  };
  if (verified.version) result.version = verified.version;
  return result;
}

export async function updateHarness(harness: Harness, options: HarnessManagementOptions = {}): Promise<HarnessActionResult> {
  const runtime = await inspectHarnessRuntime(harness, options);
  if (!runtime.status.installed) {
    throw new Error(`${runtime.displayName} is not installed. Use a harness install first.`);
  }

  const installer = runtime.status.availableInstallers[0];
  if (!installer) {
    throw new Error(
      `No supported package manager is available to update ${runtime.displayName}. Install one of: ` +
      runtime.installers.map((candidate) => packageManagerDefinition(candidate.manager).command).join(', ') +
      '.',
    );
  }

  const args = packageManagerDefinition(installer.manager).upgradeArgs(installer.package);
  await runManagerCommand(installer.manager, args, options);
  const verified = await verifyInstalled(harness, options);

  const result: HarnessActionResult = {
    harness,
    manager: installer.manager,
    package: installer.package,
    command: packageManagerDefinition(installer.manager).command,
    args,
  };
  if (verified.version) result.version = verified.version;
  return result;
}

export async function uninstallHarness(harness: Harness, options: HarnessManagementOptions = {}): Promise<HarnessActionResult> {
  const runtime = await inspectHarnessRuntime(harness, options);
  if (!runtime.status.installed) {
    throw new Error(`${runtime.displayName} is not installed.`);
  }

  const attempted: string[] = [];
  for (const installer of runtime.status.availableInstallers) {
    const definition = packageManagerDefinition(installer.manager);
    const args = definition.uninstallArgs(installer.package);
    try {
      await runManagerCommand(installer.manager, args, options);
    } catch (error) {
      attempted.push(`${formatCommand(definition.command, args)} (${errorMessage(error instanceof Error ? error : String(error))})`);
      continue;
    }

    const after = await inspectHarnessRuntime(harness, options);
    if (!after.status.installed) {
      const result: HarnessActionResult = {
        harness,
        manager: installer.manager,
        package: installer.package,
        command: definition.command,
        args,
      };
      return result;
    }

    attempted.push(`${formatCommand(definition.command, args)} (${runtime.command} is still available)`);
  }

  throw new Error(
    `Could not uninstall ${runtime.displayName}. The binary was not installed by a supported package manager, or the removal failed. Attempted: ` +
    (attempted.join('; ') || 'no supported package manager available') +
    '.',
  );
}
