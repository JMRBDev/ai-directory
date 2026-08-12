import { resolve } from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  clearConfigFile,
  getConfigPath,
  getInstallManifestPath,
  getRepositorySetting,
  readConfigFile,
  writeConfigFile,
  type ConfigScope,
} from '@ai-directory/config';
import {
  assertInstallationFilesUnchanged,
  createInstallationRecords,
  getHarnessAdapter,
  readInstallationManifest,
  removeInstallationRecord,
  saveInstallationRecords,
  uninstallInstallation,
  type Harness,
  type InstallOptions,
  type InstallScope,
  type InstallationRecord,
} from '@ai-directory/installers';
import { resourceKey } from '@ai-directory/domain';
import {
  readRegistrySourceResource,
  resolveRegistrySource,
  type RegistrySource,
  type ResourceVersion,
} from '@ai-directory/registry';

export type ServerOptions = {
  cwd?: string;
  homeDirectory?: string;
  registryIndexPath?: string;
  environment?: NodeJS.ProcessEnv;
};

type ConfigRequest = {
  repository?: unknown;
  scope?: unknown;
};

type ResourceRequest = {
  resource: string;
  harnesses: Harness[];
  scope: InstallScope;
  version?: string;
  force: boolean;
};

function isConfigScope(value: unknown): value is ConfigScope {
  return value === 'user' || value === 'project';
}

function isInstallScope(value: unknown): value is InstallScope {
  return value === 'project' || value === 'global';
}

function isHarness(value: unknown): value is Harness {
  return value === 'claude-code' || value === 'opencode' || value === 'codex';
}

function harnessValues(value: unknown): string[] {
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return [];
}

function configResponse(cwd: string) {
  const setting = getRepositorySetting(undefined, cwd);

  return {
    repository: setting.value ?? null,
    source: setting.source,
  };
}

function registrySource(options: ServerOptions, cwd: string): RegistrySource {
  const configuredIndex = options.registryIndexPath ?? process.env.AI_DIRECTORY_REGISTRY_INDEX;
  const indexPath = configuredIndex?.trim()
    ? resolve(cwd, configuredIndex.trim())
    : undefined;

  return resolveRegistrySource({
    ...(indexPath ? { indexPath } : {}),
    ...(getRepositorySetting(undefined, cwd).value
      ? { repositoryUrl: getRepositorySetting(undefined, cwd).value }
      : {}),
  });
}

function installOptions(
  scope: InstallScope,
  options: ServerOptions,
  force: boolean,
): InstallOptions {
  return {
    scope,
    force,
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.homeDirectory ? { homeDirectory: options.homeDirectory } : {}),
    ...(options.environment ? { environment: options.environment } : {}),
  };
}

function requestError(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return 'Request body must be a JSON object.';
  }

  const request = body as Record<string, unknown>;

  if (typeof request.resource !== 'string' || !request.resource.trim()) {
    return 'resource must be a non-empty string.';
  }

  const rawHarnesses = request.harnesses ?? request.harness;
  const harnesses = harnessValues(rawHarnesses);

  if (harnesses.length === 0) {
    return 'harnesses must include one or more of claude-code, opencode, or codex.';
  }

  if (harnesses.some((harness) => !isHarness(harness))) {
    return 'harnesses must include only claude-code, opencode, or codex.';
  }

  if (!isInstallScope(request.scope)) {
    return 'scope must be project or global.';
  }

  if (request.version !== undefined && typeof request.version !== 'string') {
    return 'version must be a string.';
  }

  if (typeof request.version === 'string' && !request.version.trim()) {
    return 'version must be a non-empty string.';
  }

  if (request.force !== undefined && typeof request.force !== 'boolean') {
    return 'force must be a boolean.';
  }

  return null;
}

function parseResourceRequest(body: unknown): ResourceRequest {
  const request = body as Record<string, unknown>;

  return {
    resource: (request.resource as string).trim(),
    harnesses: [...new Set(harnessValues(request.harnesses ?? request.harness))] as Harness[],
    scope: request.scope as InstallScope,
    ...(request.version !== undefined
      ? { version: (request.version as string).trim() }
      : {}),
    force: request.force === true,
  };
}

async function installationResourceIds(
  resource: string,
  source: RegistrySource,
): Promise<string[]> {
  if (!resource.includes('/templates/')) return [resource];

  const loaded = await readRegistrySourceResource(source, resource);
  return loaded.resources.map((item) => resourceKey(item.resource));
}

function requestWarnings(resources: ResourceVersion[]): string[] {
  return [...new Set(resources
    .filter((resource) => resource.resource.reviewStatus === 'unreviewed')
    .map((resource) => `${resourceKey(resource.resource)}@${resource.version}`))];
}

async function jsonBody(context: { req: { json: <T>() => Promise<T> } }): Promise<unknown> {
  return context.req.json<unknown>();
}

export function createApp(options: ServerOptions = {}) {
  const app = new Hono();
  const cwd = resolve(options.cwd ?? process.cwd());

  app.get('/health', (context) => context.json({ ok: true }));
  app.use('/api/*', cors({ origin: '*' }));

  app.get('/api/config', (context) => context.json(configResponse(cwd)));

  app.put('/api/config', async (context) => {
    let body: unknown;

    try {
      body = await jsonBody(context);
    } catch {
      return context.json({ error: 'Request body must be valid JSON.' }, 400);
    }

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return context.json({ error: 'Request body must be a JSON object.' }, 400);
    }

    const request = body as ConfigRequest;

    if (typeof request.repository !== 'string' || !request.repository.trim()) {
      return context.json({ error: 'repository must be a non-empty string.' }, 400);
    }

    if (!isConfigScope(request.scope)) {
      return context.json({ error: 'scope must be user or project.' }, 400);
    }

    const path = getConfigPath(request.scope, cwd);
    const current = readConfigFile(path);
    await writeConfigFile(path, { ...current, repository: request.repository.trim() });

    return context.json({ ...configResponse(cwd), savedScope: request.scope });
  });

  app.delete('/api/config', async (context) => {
    const scope = context.req.query('scope');

    if (!isConfigScope(scope)) {
      return context.json({ error: 'scope must be user or project.' }, 400);
    }

    await clearConfigFile(getConfigPath(scope, cwd));
    return context.json({ ...configResponse(cwd), clearedScope: scope });
  });

  app.get('/api/installed', async (context) => {
    const requestedScope = context.req.query('scope');

    if (requestedScope !== undefined && !isInstallScope(requestedScope)) {
      return context.json({ error: 'scope must be project or global.' }, 400);
    }

    const scopes: InstallScope[] = requestedScope
      ? [requestedScope]
      : ['project', 'global'];
    const installations = (
      await Promise.all(
        scopes.map(async (scope) =>
          (await readInstallationManifest(getInstallManifestPath(scope, cwd))).installations,
        ),
      )
    ).flat();

    return context.json({ installations });
  });

  app.post('/api/install', async (context) => {
    let body: unknown;

    try {
      body = await jsonBody(context);
    } catch {
      return context.json({ error: 'Request body must be valid JSON.' }, 400);
    }

    const error = requestError(body);
    if (error) return context.json({ error }, 400);

    try {
      const request = parseResourceRequest(body);
      const loaded = await readRegistrySourceResource(
        registrySource(options, cwd),
        request.resource,
        request.version,
      );
      const optionsForInstall = installOptions(request.scope, { ...options, cwd }, request.force);
      const records: InstallationRecord[] = [];

      for (const harness of request.harnesses) {
        const installer = getHarnessAdapter(harness);
        const installations = await installer.install(loaded.resources, optionsForInstall);
        const nextRecords = createInstallationRecords(
          loaded.resources,
          installations,
          request.scope,
          installer.harness,
        );
        const manifestPath = getInstallManifestPath(request.scope, cwd);
        await saveInstallationRecords(manifestPath, nextRecords, optionsForInstall);
        records.push(...nextRecords);
      }

      return context.json({
        resource: loaded.resource,
        harnesses: request.harnesses,
        records,
        warnings: requestWarnings([loaded.resource, ...loaded.resources]),
      });
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 400);
    }
  });

  app.post('/api/update', async (context) => {
    let body: unknown;

    try {
      body = await jsonBody(context);
    } catch {
      return context.json({ error: 'Request body must be valid JSON.' }, 400);
    }

    const error = requestError(body);
    if (error) return context.json({ error }, 400);

    try {
      const request = parseResourceRequest(body);
      const manifestPath = getInstallManifestPath(request.scope, cwd);
      const manifest = await readInstallationManifest(manifestPath);
      const loaded = await readRegistrySourceResource(
        registrySource(options, cwd),
        request.resource,
      );
      const existing = request.harnesses.map((harness) =>
        loaded.resources.map((resource) =>
          manifest.installations.find(
            (record) =>
              record.resource === resourceKey(resource.resource) &&
              record.harness === harness &&
              record.scope === request.scope,
          ),
        ),
      );

      if (existing.some((records) => records.some((record) => !record))) {
        const missing = request.harnesses.filter((_, index) =>
          existing[index]?.some((record) => !record),
        );
        throw new Error(
          `${request.resource} is not installed for ${missing.join(', ')} in the ${request.scope} scope.`,
        );
      }

      const existingRecords = existing.flatMap((records) =>
        records.filter(
          (record): record is NonNullable<typeof record> => record !== undefined,
        ),
      );
      for (const record of existingRecords) {
        await assertInstallationFilesUnchanged(record, request.force);
      }

      const updatedHarnesses = request.harnesses.filter((_, index) =>
        loaded.resources.some(
          (resource, resourceIndex) =>
            resource.version !== existing[index]?.[resourceIndex]?.version,
        ),
      );

      if (updatedHarnesses.length === 0) {
        return context.json({
          updated: false,
          harnesses: request.harnesses,
          records: existingRecords,
          warnings: [],
        });
      }

      const records: InstallationRecord[] = [];
      const optionsForInstall = installOptions(request.scope, { ...options, cwd }, true);

      for (const harness of updatedHarnesses) {
        const installer = getHarnessAdapter(harness);
        const installations = await installer.install(loaded.resources, optionsForInstall);
        const nextRecords = createInstallationRecords(
          loaded.resources,
          installations,
          request.scope,
          installer.harness,
        );
        await saveInstallationRecords(
          manifestPath,
          nextRecords,
          installOptions(request.scope, { ...options, cwd }, request.force),
        );
        records.push(...nextRecords);
      }

      return context.json({
        updated: true,
        harnesses: updatedHarnesses,
        records,
        warnings: requestWarnings([loaded.resource, ...loaded.resources]),
      });
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 400);
    }
  });

  app.delete('/api/installed', async (context) => {
    const rawRequest = {
      resource: context.req.query('resource'),
      harnesses: context.req.query('harnesses'),
      harness: context.req.query('harness'),
      scope: context.req.query('scope'),
      force: queryBoolean(context.req.query('force')),
    };
    const error = requestError(rawRequest);

    if (error) return context.json({ error }, 400);

    try {
      const request = parseResourceRequest(rawRequest);
      const manifestPath = getInstallManifestPath(request.scope, cwd);
      const manifest = await readInstallationManifest(manifestPath);
      const resourceIds = await installationResourceIds(
        request.resource,
        registrySource(options, cwd),
      );
      const existing = request.harnesses.map((harness) =>
        resourceIds.map((resource) =>
          manifest.installations.find(
            (record) =>
              record.resource === resource &&
              record.harness === harness &&
              record.scope === request.scope,
          ),
        ),
      );

      if (existing.some((records) => records.some((record) => !record))) {
        const missing = request.harnesses.filter((_, index) =>
          existing[index]?.some((record) => !record),
        );
        throw new Error(
          `${request.resource} is not installed for ${missing.join(', ')} in the ${request.scope} scope.`,
        );
      }

      const existingRecords = existing.flatMap((records) =>
        records.filter(
          (record): record is NonNullable<typeof record> => record !== undefined,
        ),
      );
      for (const record of existingRecords) {
        await assertInstallationFilesUnchanged(record, request.force);
      }
      for (const record of existingRecords) {
        await uninstallInstallation(
          record,
          installOptions(request.scope, { ...options, cwd }, request.force),
        );
        await removeInstallationRecord(manifestPath, record);
      }

      return context.json({ removed: existingRecords, harnesses: request.harnesses });
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 400);
    }
  });

  return app;
}

function queryBoolean(value: string | undefined): boolean | string | undefined {
  if (value === undefined) return undefined;
  return value === 'true' ? true : value === 'false' ? false : value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
