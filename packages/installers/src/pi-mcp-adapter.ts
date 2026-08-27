import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathExists } from '@ai-directory/config';
import { defaultCommandRunner, type DependencyCommandRunner } from './dependencies.js';
import { errorMessage } from './errors.js';
import { resolveHarnessPaths, type HarnessPathOptions } from './harnesses.js';

export const PI_MCP_ADAPTER_PACKAGE = 'pi-mcp-adapter';
export const PI_MCP_ADAPTER_REFERENCE = `npm:${PI_MCP_ADAPTER_PACKAGE}`;

export type PiMcpAdapterOptions = HarnessPathOptions & {
  commandRunner?: DependencyCommandRunner;
};

export type PiMcpAdapterStatus = {
  installed: boolean;
  version?: string;
  installCommand: string;
  uninstallCommand: string;
};

function piNpmModules(options: HarnessPathOptions): string {
  const location = resolveHarnessPaths('pi', options);
  return join(location.config, 'npm', 'node_modules');
}

export async function inspectPiMcpAdapter(
  options: HarnessPathOptions = {},
): Promise<PiMcpAdapterStatus> {
  const packagePath = join(piNpmModules(options), PI_MCP_ADAPTER_PACKAGE, 'package.json');
  let installed = false;
  let version: string | undefined;

  if (await pathExists(packagePath)) {
    try {
      // SAFETY: Pi npm packages are JSON with an optional version field.
      const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as { version?: string };
      installed = true;
      if (packageJson.version) version = packageJson.version;
    } catch {
      installed = false;
    }
  }

  const status: PiMcpAdapterStatus = {
    installed,
    installCommand: `pi install ${PI_MCP_ADAPTER_REFERENCE}`,
    uninstallCommand: `pi uninstall ${PI_MCP_ADAPTER_REFERENCE}`,
  };
  if (version !== undefined) status.version = version;

  return status;
}

export type PiMcpAdapterActionResult = {
  installed: boolean;
  command: string;
  args: string[];
  version?: string;
};

async function runPiCommand(
  command: string,
  args: string[],
  options: PiMcpAdapterOptions,
): Promise<void> {
  const runner: DependencyCommandRunner = options.commandRunner ?? defaultCommandRunner;
  const environment = { ...process.env, ...options.environment };

  try {
    await runner(command, args, options.cwd ?? process.cwd(), environment);
  } catch (error) {
    throw new Error(
      `Could not run ${command} ${args.join(' ')}: ${errorMessage(error instanceof Error ? error : String(error))}`,
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

export async function installPiMcpAdapter(
  options: PiMcpAdapterOptions = {},
): Promise<PiMcpAdapterActionResult> {
  const command = 'pi';
  const args = ['install', PI_MCP_ADAPTER_REFERENCE];

  await runPiCommand(command, args, options);

  const status = await inspectPiMcpAdapter(options);
  const result: PiMcpAdapterActionResult = {
    installed: status.installed,
    command,
    args,
  };
  if (status.version !== undefined) result.version = status.version;
  return result;
}

export async function uninstallPiMcpAdapter(
  options: PiMcpAdapterOptions = {},
): Promise<PiMcpAdapterActionResult> {
  const command = 'pi';
  const args = ['uninstall', PI_MCP_ADAPTER_REFERENCE];

  await runPiCommand(command, args, options);

  const status = await inspectPiMcpAdapter(options);
  const result: PiMcpAdapterActionResult = {
    installed: status.installed,
    command,
    args,
  };
  if (status.version !== undefined) result.version = status.version;
  return result;
}
