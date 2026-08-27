import { resolve, sep } from 'node:path';
import type { Harness, ToolPackageManager } from '@ai-directory/contracts';
import {
  defaultCommandRunner,
  extractVersion,
  formatCommand,
  packageManagerDefinition,
  type DependencyCommandRunner,
  type DependencyCommandResult,
  type ToolDependencyOptions,
} from './dependencies.js';
import { errorMessage } from './errors.js';
import { findExecutable, getHarnessDefinition } from './harnesses.js';

export type HarnessManagementOptions = ToolDependencyOptions;

export type HarnessOrigin = 'npm' | 'homebrew' | 'native';

export type HarnessStatus = {
  harness: Harness;
  displayName: string;
  command: string;
  installed: boolean;
  availableChannels: HarnessDefinitionInstallers;
  installCommand: string;
  upgradeCommand: string;
  uninstallCommand: string;
  version?: string;
  versionOutput?: string;
  failure?: string;
  origin?: HarnessOrigin;
  originPath?: string;
};

type HarnessDefinitionInstallers = ReturnType<typeof getHarnessDefinition>['installers'];

export type HarnessActionResult = {
  harness: Harness;
  method: 'script' | 'npm' | 'self-update';
  manager?: ToolPackageManager;
  package?: string;
  command: string;
  args: string[];
  version?: string;
};

const brewPrefixes = ['/opt/homebrew', '/usr/local/Homebrew', '/home/linuxbrew/.linuxbrew'];

function harnessRuntime(harness: Harness) {
  const definition = getHarnessDefinition(harness);
  return {
    command: definition.command,
    installers: definition.installers,
    displayName: definition.displayName,
    selfUpdate: definition.selfUpdate,
  };
}

function runnerFor(options: HarnessManagementOptions): DependencyCommandRunner {
  return options.commandRunner ?? defaultCommandRunner;
}

function runnerEnvironment(options: HarnessManagementOptions): NodeJS.ProcessEnv {
  return { ...process.env, ...options.environment };
}

async function probeChannel(
  channel: HarnessDefinitionInstallers[number],
  options: HarnessManagementOptions,
): Promise<boolean> {
  const runner = runnerFor(options);
  const cwd = options.cwd ?? process.cwd();
  const environment = runnerEnvironment(options);

  try {
    if (channel.kind === 'manager') {
      await runner(packageManagerDefinition(channel.manager).command, ['--version'], cwd, environment);
    } else {
      await runner(channel.command, ['-c', 'command -v curl'], cwd, environment);
    }
    return true;
  } catch {
    return false;
  }
}

function npmChannel(harness: Harness) {
  const channel = getHarnessDefinition(harness).installers.find(
    (candidate): candidate is Extract<HarnessDefinitionInstallers[number], { kind: 'manager' }> =>
      candidate.kind === 'manager',
  );
  return channel;
}

async function detectOrigin(
  harness: Harness,
  options: HarnessManagementOptions,
): Promise<{ origin: HarnessOrigin; path?: string }> {
  const definition = getHarnessDefinition(harness);
  const runner = runnerFor(options);
  const cwd = options.cwd ?? process.cwd();
  const environment = runnerEnvironment(options);

  const resolved = await findExecutable(definition.command, environment);
  if (!resolved) return { origin: 'native' };

  const resolvedPath = resolve(resolved);

  if (brewPrefixes.some((prefix) => resolvedPath.startsWith(prefix))) {
    return { origin: 'homebrew', path: resolvedPath };
  }

  if (npmChannel(harness)) {
    try {
      const prefix = (await runner('npm', ['prefix', '--global'], cwd, environment)).stdout.trim();
      if (prefix && resolvedPath.startsWith(resolve(prefix, 'bin') + sep)) {
        return { origin: 'npm', path: resolvedPath };
      }
    } catch {
      // npm is unavailable or has no global prefix; classify by binary location.
    }
  }

  return { origin: 'native', path: resolvedPath };
}

async function inspectHarnessRuntime(
  harness: Harness,
  options: HarnessManagementOptions,
) {
  const runtime = harnessRuntime(harness);
  const runner = runnerFor(options);
  const cwd = options.cwd ?? process.cwd();
  const environment = runnerEnvironment(options);
  let installed = false;
  let versionOutput: string | undefined;
  let failure: string | undefined;

  try {
    const result = await runner(runtime.command, ['--version'], cwd, environment);
    versionOutput = (result.stdout + '\n' + result.stderr).trim();
    installed = versionOutput.length > 0;
  } catch (error) {
    failure = errorMessage(error instanceof Error ? error : String(error));
  }

  const availability = await Promise.all(
    runtime.installers.map(async (channel) => ({
      channel,
      available: installed || (await probeChannel(channel, options)),
    })),
  );
  const availableChannels = availability
    .filter((entry) => entry.available)
    .map((entry) => entry.channel);

  const origin = installed ? await detectOrigin(harness, options) : undefined;

  return { runtime, installed, versionOutput, failure, availableChannels, origin };
}

function channelCommand(channel: HarnessDefinitionInstallers[number], mode: 'install' | 'upgrade' | 'uninstall'): string {
  if (channel.kind === 'script') return formatCommand(channel.command, channel.args);

  const definition = packageManagerDefinition(channel.manager);
  const args = mode === 'install'
    ? definition.installArgs(channel.package)
    : mode === 'upgrade'
      ? definition.upgradeArgs(channel.package)
      : definition.uninstallArgs(channel.package);
  return formatCommand(definition.command, args);
}

function harnessStatus(
  harness: Harness,
  runtime: ReturnType<typeof harnessRuntime>,
  inspected: Awaited<ReturnType<typeof inspectHarnessRuntime>>,
): HarnessStatus {
  const preferred = inspected.availableChannels[0] ?? runtime.installers[0];
  if (!preferred) throw new Error(`No install channel is configured for ${harness}.`);
  const npm = npmChannel(harness);

  const result: HarnessStatus = {
    harness,
    displayName: runtime.displayName,
    command: runtime.command,
    installed: inspected.installed,
    availableChannels: inspected.availableChannels,
    installCommand: channelCommand(preferred, 'install'),
    upgradeCommand: runtime.selfUpdate
      ? formatCommand(runtime.selfUpdate.command, runtime.selfUpdate.args)
      : npm
        ? channelCommand(npm, 'upgrade')
        : '',
    uninstallCommand: npm ? channelCommand(npm, 'uninstall') : '',
  };
  if (inspected.versionOutput) {
    const version = extractVersion(inspected.versionOutput);
    if (version) result.version = version;
    result.versionOutput = inspected.versionOutput;
  }
  if (inspected.failure) result.failure = inspected.failure;
  if (inspected.origin) {
    result.origin = inspected.origin.origin;
    if (inspected.origin.path) result.originPath = inspected.origin.path;
  }

  return result;
}

export async function inspectHarness(harness: Harness, options: HarnessManagementOptions = {}): Promise<HarnessStatus> {
  const runtime = harnessRuntime(harness);
  const inspected = await inspectHarnessRuntime(harness, options);
  return harnessStatus(harness, runtime, inspected);
}

export async function inspectHarnesses(options: HarnessManagementOptions = {}): Promise<HarnessStatus[]> {
  return Promise.all(
    (['claude-code', 'opencode', 'codex', 'pi'] as const).map((harness) => inspectHarness(harness, options)),
  );
}

async function runCommand(
  command: string,
  args: string[],
  options: HarnessManagementOptions,
): Promise<DependencyCommandResult> {
  const runner = runnerFor(options);
  const cwd = options.cwd ?? process.cwd();
  const environment = runnerEnvironment(options);

  try {
    return await runner(command, args, cwd, environment);
  } catch (error) {
    throw new Error(
      `Could not run ${formatCommand(command, args)}: ${errorMessage(error instanceof Error ? error : String(error))}`,
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

async function verifyInstalled(harness: Harness, options: HarnessManagementOptions): Promise<string | undefined> {
  const inspected = await inspectHarnessRuntime(harness, options);
  if (!inspected.installed) {
    throw new Error(`Verified ${inspected.runtime.displayName}, but ${inspected.runtime.command} did not respond after the action.`);
  }

  return inspected.versionOutput ? extractVersion(inspected.versionOutput) : undefined;
}

function actionResult(
  harness: Harness,
  method: HarnessActionResult['method'],
  command: string,
  args: string[],
  version: string | undefined,
  managerChannel?: Extract<HarnessDefinitionInstallers[number], { kind: 'manager' }>,
): HarnessActionResult {
  const result: HarnessActionResult = { harness, method, command, args };
  if (version) result.version = version;
  if (managerChannel && method === 'npm') {
    result.manager = managerChannel.manager;
    result.package = managerChannel.package;
  }
  return result;
}

export async function installHarness(harness: Harness, options: HarnessManagementOptions = {}): Promise<HarnessActionResult> {
  const runtime = harnessRuntime(harness);
  const inspected = await inspectHarnessRuntime(harness, options);
  if (inspected.installed) {
    throw new Error(
      `${runtime.displayName} is already installed${inspected.versionOutput ? ` (${extractVersion(inspected.versionOutput) ?? 'unknown version'})` : ''}. Use a harness update to upgrade it.`,
    );
  }

  const channel = inspected.availableChannels[0];
  if (!channel) {
    throw new Error(
      `No supported install channel is available for ${runtime.displayName}. Install one of: ` +
      runtime.installers.map((candidate) => candidate.kind === 'manager'
        ? packageManagerDefinition(candidate.manager).command
        : candidate.command)
        .join(', ') +
      '.',
    );
  }
  if (channel.kind === 'script') {
    await runCommand(channel.command, channel.args, options);
    const version = await verifyInstalled(harness, options);
    return actionResult(harness, 'script', channel.command, channel.args, version);
  }

  const definition = packageManagerDefinition(channel.manager);
  const args = definition.installArgs(channel.package);
  await runCommand(definition.command, args, options);
  const version = await verifyInstalled(harness, options);
  return actionResult(harness, 'npm', definition.command, args, version, channel);
}

export async function updateHarness(harness: Harness, options: HarnessManagementOptions = {}): Promise<HarnessActionResult> {
  const runtime = harnessRuntime(harness);
  const inspected = await inspectHarnessRuntime(harness, options);
  if (!inspected.installed) {
    throw new Error(`${runtime.displayName} is not installed. Use a harness install first.`);
  }

  const selfUpdate = runtime.selfUpdate;
  if (selfUpdate) {
    try {
      await runCommand(selfUpdate.command, selfUpdate.args, options);
      const version = await verifyInstalled(harness, options);
      return actionResult(harness, 'self-update', selfUpdate.command, selfUpdate.args, version);
    } catch (selfUpdateError) {
      if (inspected.origin?.origin !== 'npm') {
        throw new Error(
          `${errorMessage(selfUpdateError)} ${runtime.displayName} was not installed through a supported package manager, so no package-manager fallback is available.`,
        );
      }
      try {
        return await updateWithNpm(harness, options);
      } catch (fallbackError) {
        throw new Error(
          `${errorMessage(selfUpdateError)} Package manager fallback failed: ${errorMessage(fallbackError)}`,
        );
      }
    }
  }

  if (inspected.origin?.origin !== 'npm') {
    throw new Error(
      `${runtime.displayName} was installed outside a supported package manager${inspected.origin?.path ? ` (${inspected.origin.path})` : ''}. Upgrade it through its own installer, then run aid harness update again.`,
    );
  }

  return updateWithNpm(harness, options);
}

async function updateWithNpm(harness: Harness, options: HarnessManagementOptions): Promise<HarnessActionResult> {
  const npm = npmChannel(harness);
  if (!npm) throw new Error(`No npm package is configured for ${harness}.`);

  const definition = packageManagerDefinition(npm.manager);
  const args = definition.upgradeArgs(npm.package);
  await runCommand(definition.command, args, options);
  const version = await verifyInstalled(harness, options);
  return actionResult(harness, 'npm', definition.command, args, version, npm);
}

export async function uninstallHarness(harness: Harness, options: HarnessManagementOptions = {}): Promise<HarnessActionResult> {
  const runtime = harnessRuntime(harness);
  const inspected = await inspectHarnessRuntime(harness, options);
  if (!inspected.installed) {
    throw new Error(`${runtime.displayName} is not installed.`);
  }

  if (inspected.origin?.origin !== 'npm') {
    throw new Error(
      `${runtime.displayName} was installed outside a supported package manager${inspected.origin?.path ? ` (${inspected.origin.path})` : ''}. Remove it manually if you no longer need it; your ${runtime.command} configuration directory stays in place either way.`,
    );
  }

  const npm = npmChannel(harness);
  if (!npm) throw new Error(`No npm package is configured for ${harness}.`);

  const definition = packageManagerDefinition(npm.manager);
  const args = definition.uninstallArgs(npm.package);
  await runCommand(definition.command, args, options);

  const after = await inspectHarnessRuntime(harness, options);
  if (after.installed) {
    throw new Error(`${runtime.displayName} is still available after uninstalling with ${formatCommand(definition.command, args)}.`);
  }

  return actionResult(harness, 'npm', definition.command, args, undefined, npm);
}
