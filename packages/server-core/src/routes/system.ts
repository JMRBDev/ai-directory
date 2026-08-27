import type { Context } from 'hono';
import {
  clearConfigFile,
  getConfigPath,
  readConfigFile,
  writeConfigFile,
} from '@ai-directory/config';
import { harnessSchema, HARNESS_ID_LIST } from '@ai-directory/contracts';
import {
  detectHarnesses,
  errorMessage,
  inspectHarnesses,
  inspectPiMcpAdapter,
  installHarness,
  installPiMcpAdapter,
  uninstallHarness,
  uninstallPiMcpAdapter,
  updateHarness,
  type HarnessManagementOptions,
  type PiMcpAdapterOptions,
} from '@ai-directory/installers';
import { configResponse, githubUsername } from '../environment.js';
import { jsonBody } from '../http.js';
import { cachedRegistry } from '../planning.js';
import { configRequestSchema, configScopeSchema } from '../requests.js';
import type { RequestBody, RouteContext, ServerOptions } from '../types.js';

const harnessManagementError = `harness must be one of ${HARNESS_ID_LIST}.`;

export function registerSystemRoutes({ app, options, cwd }: RouteContext): void {
  app.get('/api/harnesses', async (context) => {
    try {
      const detectionOptions: NonNullable<Parameters<typeof detectHarnesses>[0]> = { cwd };
      if (options.homeDirectory) detectionOptions.homeDirectory = options.homeDirectory;
      if (options.environment) detectionOptions.environment = options.environment;
      const managementOptions = harnessManagementOptions(options, cwd);

      const [detections, statuses] = await Promise.all([
        detectHarnesses(detectionOptions),
        inspectHarnesses(managementOptions),
      ]);

      const harnesses = detections.map((detection) => {
        const status = statuses.find((candidate) => candidate.harness === detection.harness);
        const merged: typeof detection & {
          installed: boolean;
          installCommand?: string;
          upgradeCommand?: string;
          uninstallCommand?: string;
          version?: string;
          origin?: string;
          originPath?: string;
        } = {
          ...detection,
          installed: status?.installed ?? detection.detected,
        };
        if (status) {
          merged.installCommand = status.installCommand;
          merged.upgradeCommand = status.upgradeCommand;
          merged.uninstallCommand = status.uninstallCommand;
          if (status.version) merged.version = status.version;
          if (status.origin) {
            merged.origin = status.origin;
            if (status.originPath) merged.originPath = status.originPath;
          }
        }
        return merged;
      });

      return context.json({ harnesses });
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 500);
    }
  });

  app.post('/api/harnesses/install', (context) => harnessAction(context, options, cwd, 'install'));
  app.post('/api/harnesses/update', (context) => harnessAction(context, options, cwd, 'update'));
  app.post('/api/harnesses/uninstall', (context) => harnessAction(context, options, cwd, 'uninstall'));

  app.get('/api/pi/mcp-adapter', async (context) => {
    try {
      return context.json({ adapter: await inspectPiMcpAdapter(piAdapterOptions(options, cwd)) });
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 500);
    }
  });

  app.post('/api/pi/mcp-adapter/install', async (context) => {
    try {
      return context.json({ result: await installPiMcpAdapter(piAdapterOptions(options, cwd)) });
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 400);
    }
  });

  app.post('/api/pi/mcp-adapter/uninstall', async (context) => {
    try {
      return context.json({ result: await uninstallPiMcpAdapter(piAdapterOptions(options, cwd)) });
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 400);
    }
  });

  app.post('/api/refresh', async (context) => {
    try {
      await cachedRegistry.refresh();
      return context.json({ ok: true });
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 500);
    }
  });

  app.get('/api/github-user', async (context) => {
    try {
      return context.json({ username: await githubUsername(options, cwd) });
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 503);
    }
  });

  app.get('/api/config', (context) => context.json(configResponse(cwd)));

  app.put('/api/config', async (context) => {
    let body: RequestBody;

    try {
      body = await jsonBody(context);
    } catch {
      return context.json({ error: 'Request body must be valid JSON.' }, 400);
    }

    const result = configRequestSchema.safeParse(body);

    if (!result.success) {
      const issue = result.error.issues[0];
      const error = issue?.path[0] === 'repository'
        ? 'repository must be a non-empty string.'
        : issue?.path[0] === 'scope'
          ? 'scope must be user or project.'
          : 'Request body must be a JSON object.';
      return context.json({ error }, 400);
    }

    const request = result.data;
    const path = getConfigPath(request.scope, cwd);
    const current = readConfigFile(path);
    await writeConfigFile(path, { ...current, repository: request.repository });

    return context.json({ ...configResponse(cwd), savedScope: request.scope });
  });

  app.delete('/api/config', async (context) => {
    const scopeResult = configScopeSchema.safeParse(context.req.query('scope'));

    if (!scopeResult.success) {
      return context.json({ error: 'scope must be user or project.' }, 400);
    }

    const scope = scopeResult.data;
    await clearConfigFile(getConfigPath(scope, cwd));
    return context.json({ ...configResponse(cwd), clearedScope: scope });
  });
}

function harnessManagementOptions(options: ServerOptions, cwd: string): HarnessManagementOptions {
  const managementOptions: HarnessManagementOptions = { cwd };
  if (options.environment) managementOptions.environment = options.environment;
  if (options.dependencyCommandRunner) managementOptions.commandRunner = options.dependencyCommandRunner;
  return managementOptions;
}

function piAdapterOptions(options: ServerOptions, cwd: string): PiMcpAdapterOptions {
  const adapterOptions: PiMcpAdapterOptions = { cwd };
  if (options.homeDirectory) adapterOptions.homeDirectory = options.homeDirectory;
  if (options.environment) adapterOptions.environment = options.environment;
  if (options.dependencyCommandRunner) adapterOptions.commandRunner = options.dependencyCommandRunner;
  return adapterOptions;
}

async function harnessAction(
  context: Context,
  options: ServerOptions,
  cwd: string,
  action: 'install' | 'update' | 'uninstall',
): Promise<Response> {
  let body: RequestBody;

  try {
    body = await jsonBody(context);
  } catch {
    return context.json({ error: 'Request body must be valid JSON.' }, 400);
  }

  const harness = harnessSchema.safeParse(body.harness);
  if (!harness.success) return context.json({ error: harnessManagementError }, 400);

  try {
    const result = action === 'install'
      ? await installHarness(harness.data, harnessManagementOptions(options, cwd))
      : action === 'update'
        ? await updateHarness(harness.data, harnessManagementOptions(options, cwd))
        : await uninstallHarness(harness.data, harnessManagementOptions(options, cwd));
    return context.json({ result });
  } catch (caught) {
    return context.json({ error: errorMessage(caught) }, 400);
  }
}

