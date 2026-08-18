import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineCommand } from 'citty';
import { DEFAULT_API_HOST, DEFAULT_API_PORT, findWorkspaceRoot } from '@ai-directory/config';

interface SpawnEnvironment extends NodeJS.ProcessEnv {
  AI_DIRECTORY_CONFIG_CWD: string;
  AI_DIRECTORY_PORT?: string;
  AI_DIRECTORY_REGISTRY_INDEX?: string;
  PUBLIC_AI_DIRECTORY_API_URL?: string;
}

export const web = defineCommand({
  meta: {
    name: 'web',
    description: 'Start the local AI Directory website',
  },
  args: {
    index: {
      type: 'string',
      alias: 'i',
      description: 'Local registry index path; overrides the configured Git repository',
    },
    host: {
      type: 'string',
      default: DEFAULT_API_HOST,
      description: 'Host for the local website',
    },
    port: {
      type: 'string',
      default: '4321',
      description: 'Port for the local website',
    },
    'api-port': {
      type: 'string',
      default: String(DEFAULT_API_PORT),
      description: 'Port for the local configuration API',
    },
    open: {
      type: 'boolean',
      description: 'Open the website in the default browser',
    },
  },
  async run({ args }) {
    const workspaceRoot = findWorkspaceRoot(process.cwd());

    if (!workspaceRoot) {
      console.error('Could not find the AI Directory workspace from the current directory.');
      process.exitCode = 1;
      return;
    }

    const webDirectory = join(workspaceRoot, 'apps', 'web');

    if (!existsSync(webDirectory)) {
      console.error(`Website directory not found: ${webDirectory}`);
      process.exitCode = 1;
      return;
    }

    const indexPath = args.index ? resolve(workspaceRoot, args.index) : undefined;
    const apiPort = args['api-port'] ?? String(DEFAULT_API_PORT);
    const apiUrl = `http://${DEFAULT_API_HOST}:${apiPort}`;
    const apiEnv: SpawnEnvironment = {
      ...process.env,
      AI_DIRECTORY_CONFIG_CWD: process.cwd(),
      AI_DIRECTORY_PORT: apiPort,
    };
    if (indexPath) apiEnv.AI_DIRECTORY_REGISTRY_INDEX = indexPath;
    const api = Bun.spawn(['pnpm', '--filter', '@ai-directory/api', 'dev'], {
      cwd: workspaceRoot,
      env: apiEnv,
      stderr: 'inherit',
      stdout: 'inherit',
    });

    try {
      await waitForLocalApi(`${apiUrl}/health`);

      const command = [
        'pnpm',
        'dev',
        '--host',
        args.host ?? DEFAULT_API_HOST,
        '--port',
        args.port ?? '4321',
        ...(args.open ? ['--open'] : []),
      ];

      console.log(`Starting the local AI Directory website at http://${args.host}:${args.port}`);
      console.log(`Local configuration API: ${apiUrl}`);
      console.log(`Registry source: ${indexPath ?? 'configured Git repository'}`);

      const webEnv: SpawnEnvironment = {
        ...process.env,
        AI_DIRECTORY_CONFIG_CWD: process.cwd(),
        PUBLIC_AI_DIRECTORY_API_URL: apiUrl,
      };
      if (indexPath) webEnv.AI_DIRECTORY_REGISTRY_INDEX = indexPath;

      const child = Bun.spawn(command, {
        cwd: webDirectory,
        env: webEnv,
        stderr: 'inherit',
        stdout: 'inherit',
      });

      const exitCode = await child.exited;

      if (exitCode !== 0) {
        console.error(`Local website exited with code ${exitCode}.`);
        process.exitCode = exitCode;
      }
    } finally {
      api.kill();
      await api.exited;
    }
  },
});

async function waitForLocalApi(url: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The API process may need a few moments to start.
    }

    await Bun.sleep(100);
  }

  throw new Error(`Local configuration API did not start at ${url}.`);
}
