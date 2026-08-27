import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  inspectPiMcpAdapter,
  installPiMcpAdapter,
  uninstallPiMcpAdapter,
} from '../src/index.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ai-directory-pi-adapter-'));
  temporaryDirectories.push(directory);
  return directory;
}

function piOptions(directory: string) {
  return {
    cwd: directory,
    homeDirectory: directory,
    environment: { PI_CODING_AGENT_DIR: join(directory, '.pi', 'agent') },
  };
}

async function writeInstalledAdapter(
  directory: string,
  version = '2.31.0',
): Promise<void> {
  const packageRoot = join(directory, '.pi', 'agent', 'npm', 'node_modules', 'pi-mcp-adapter');
  await mkdir(packageRoot, { recursive: true });
  await writeFile(
    join(packageRoot, 'package.json'),
    JSON.stringify({ name: 'pi-mcp-adapter', version }),
    'utf8',
  );
}

describe('pi-mcp-adapter management', () => {
  it('reports not installed when the package is absent', async () => {
    const directory = await createTemporaryDirectory();
    const status = await inspectPiMcpAdapter(piOptions(directory));

    expect(status.installed).toBe(false);
    expect(status.installCommand).toBe('pi install npm:pi-mcp-adapter');
    expect(status.uninstallCommand).toBe('pi uninstall npm:pi-mcp-adapter');
  });

  it('detects an installed adapter and its version', async () => {
    const directory = await createTemporaryDirectory();
    await writeInstalledAdapter(directory);

    const status = await inspectPiMcpAdapter(piOptions(directory));

    expect(status.installed).toBe(true);
    expect(status.version).toBe('2.31.0');
  });

  it('runs pi install and reports the result', async () => {
    const directory = await createTemporaryDirectory();
    const calls: string[][] = [];
    let installed = false;

    const result = await installPiMcpAdapter({
      ...piOptions(directory),
      commandRunner: async (command, args) => {
        calls.push([command, ...args]);
        if (command === 'pi' && args[0] === 'install') {
          installed = true;
          await writeInstalledAdapter(directory);
        }
        return { stdout: '', stderr: '' };
      },
    });

    expect(calls).toEqual([['pi', 'install', 'npm:pi-mcp-adapter']]);
    expect(result.installed).toBe(true);
    expect(result.version).toBe('2.31.0');
    expect(installed).toBe(true);
  });

  it('runs pi uninstall and reports the result', async () => {
    const directory = await createTemporaryDirectory();
    await writeInstalledAdapter(directory);
    const calls: string[][] = [];

    const result = await uninstallPiMcpAdapter({
      ...piOptions(directory),
      commandRunner: async (command, args) => {
        calls.push([command, ...args]);
        if (command === 'pi' && args[0] === 'uninstall') {
          await rm(
            join(directory, '.pi', 'agent', 'npm', 'node_modules', 'pi-mcp-adapter'),
            { recursive: true, force: true },
          );
        }
        return { stdout: '', stderr: '' };
      },
    });

    expect(calls).toEqual([['pi', 'uninstall', 'npm:pi-mcp-adapter']]);
    expect(result.installed).toBe(false);
  });
});
