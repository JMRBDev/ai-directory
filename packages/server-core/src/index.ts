import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
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
  discoverLocalResources,
  enrichLocalResources,
  getHarnessAdapter,
  readInstallationManifest,
  removeInstallationRecord,
  saveInstallationRecords,
  uninstallInstallation,
  type Harness,
  type InstallChange,
  type InstallOptions,
  type InstallScope,
  type InstallationRecord,
} from '@ai-directory/installers';
import { resourceKey } from '@ai-directory/domain';
import {
  createRegistrySnapshot,
  readRegistrySourceResource,
  readRegistrySourceIndex,
  resolveRegistrySource,
  submitResource,
  type CommandRunner,
  type RegistrySnapshot,
  type RegistrySource,
  type ResourceVersion,
  validateResourceDirectory,
} from '@ai-directory/registry';

const execFileAsync = promisify(execFile);

export type ServerOptions = {
  cwd?: string;
  homeDirectory?: string;
  registryIndexPath?: string;
  environment?: NodeJS.ProcessEnv;
  commandRunner?: CommandRunner;
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

type ChangeOperation = ResourceRequest & {
  action: 'install' | 'uninstall';
};

type PlannedFileChange = {
  path: string;
  action: 'added' | 'modified' | 'removed';
  resource: string;
  harness: Harness;
  scope: InstallScope;
  before?: string;
  after?: string;
};

type ChangePlan = {
  operations: ChangeOperation[];
  changes: PlannedFileChange[];
  conflicts: string[];
  warnings: string[];
};

type ResourceUpload = {
  resourceId: string;
  version: string;
  description?: string;
  files: File[];
};

type UploadResult = {
  sourceDirectory: string;
  files: string[];
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

function isFile(value: unknown): value is File {
  return (
    typeof value === 'object' &&
    value !== null &&
    'arrayBuffer' in value &&
    typeof value.arrayBuffer === 'function' &&
    'name' in value &&
    typeof value.name === 'string'
  );
}

function uploadFiles(value: unknown): File[] {
  const values = Array.isArray(value) ? value : [value];
  return values.filter(isFile);
}

function uploadText(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === 'string' ? value.trim() : '';
}

function parseResourceUpload(body: Record<string, unknown>): ResourceUpload | string {
  const resourceId = uploadText(body, 'resourceId');
  const version = uploadText(body, 'version');
  const description = uploadText(body, 'description');
  const files = uploadFiles(body['files[]'] ?? body.files);

  if (!resourceId) return 'resourceId must be a non-empty string.';
  if (!version) return 'version must be a non-empty string.';
  if (files.length === 0) return 'files must include a resource directory.';

  return {
    resourceId,
    version,
    files,
    ...(description ? { description } : {}),
  };
}

function uploadPath(file: File): string[] {
  const name = file.name.replaceAll('\\', '/');
  if (name.startsWith('/')) throw new Error(`Uploaded file path must be relative: ${file.name}`);

  const parts = name.split('/').filter((part) => part && part !== '.');
  if (parts.length === 0 || parts.some((part) => part === '..')) {
    throw new Error(`Invalid uploaded file path: ${file.name}`);
  }

  return parts;
}

async function writeUpload(files: File[]): Promise<UploadResult> {
  const sourceDirectory = await mkdtemp(join(tmpdir(), 'ai-directory-web-submit-'));
  const root = resolve(sourceDirectory);

  try {
    for (const file of files) {
      const parts = uploadPath(file);
      const destination = resolve(root, ...parts);

      if (destination !== root && !destination.startsWith(`${root}${sep}`)) {
        throw new Error(`Uploaded file path escapes the temporary directory: ${file.name}`);
      }

      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, Buffer.from(await file.arrayBuffer()));
    }

    return {
      sourceDirectory,
      files: files.map((file) => uploadPath(file).join('/')),
    };
  } catch (error) {
    await rm(sourceDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function withResourceUpload<T>(
  upload: ResourceUpload,
  action: (sourceDirectory: string) => Promise<T>,
): Promise<T> {
  const written = await writeUpload(upload.files);

  try {
    return await action(written.sourceDirectory);
  } finally {
    await rm(written.sourceDirectory, { recursive: true, force: true });
  }
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

async function githubUsername(options: ServerOptions, cwd: string): Promise<string> {
  const result = options.commandRunner
    ? await options.commandRunner('gh', ['api', 'user', '--jq', '.login'], cwd)
    : await execFileAsync('gh', ['api', 'user', '--jq', '.login'], { cwd, encoding: 'utf8' });
  const username = result.stdout.trim().toLowerCase();

  if (!/^[a-z0-9-]+$/.test(username)) {
    throw new Error('GitHub CLI did not return a valid username.');
  }

  return username;
}

function installOptions(
  scope: InstallScope,
  options: ServerOptions,
  force: boolean,
  dryRun = false,
): InstallOptions {
  return {
    scope,
    force,
    dryRun,
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.homeDirectory ? { homeDirectory: options.homeDirectory } : {}),
    ...(options.environment ? { environment: options.environment } : {}),
  };
}

async function readInstallationRecords(
  scopes: InstallScope[],
  cwd: string,
): Promise<InstallationRecord[]> {
  return (
    await Promise.all(
      scopes.map(async (scope) =>
        (await readInstallationManifest(getInstallManifestPath(scope, cwd))).installations,
      ),
    )
  ).flat();
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

function changePlanError(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return 'Request body must be a JSON object.';
  }

  const request = body as Record<string, unknown>;
  if (!Array.isArray(request.operations) || request.operations.length === 0) {
    return 'operations must include one or more resource changes.';
  }

  if (request.force !== undefined && typeof request.force !== 'boolean') {
    return 'force must be a boolean.';
  }

  const keys = new Set<string>();
  for (const operation of request.operations) {
    if (typeof operation !== 'object' || operation === null || Array.isArray(operation)) {
      return 'Each operation must be a JSON object.';
    }

    const value = operation as Record<string, unknown>;
    if (value.action !== 'install' && value.action !== 'uninstall') {
      return 'Each operation action must be install or uninstall.';
    }

    const error = requestError(operation);
    if (error) return error;

    const parsed = parseResourceRequest(operation);
    for (const harness of parsed.harnesses) {
      const key = `${parsed.scope}:${harness}:${parsed.resource}`;
      if (keys.has(key)) return `The operation is listed more than once: ${key}.`;
      keys.add(key);
    }
  }

  return null;
}

function parseChangeOperations(body: unknown): {
  operations: ChangeOperation[];
  force: boolean;
} {
  const request = body as Record<string, unknown>;
  return {
    operations: (request.operations as unknown[]).map((operation) => ({
      ...parseResourceRequest(operation),
      action: (operation as Record<string, unknown>).action as 'install' | 'uninstall',
    })),
    force: request.force === true,
  };
}

async function currentFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function previewContent(content: string | null): string | undefined {
  if (content === null) return undefined;
  const limit = 20_000;
  return content.length > limit ? `${content.slice(0, limit)}\n…` : content;
}

function classifyChange(
  before: string | null,
  after: string | null,
): 'added' | 'modified' | 'removed' | null {
  if (after === null) return before === null ? null : 'removed';
  if (before === null) return 'added';
  return before === after ? null : 'modified';
}

async function buildChangePlan(
  operations: ChangeOperation[],
  options: ServerOptions,
  cwd: string,
  force: boolean,
  snapshot: RegistrySnapshot,
): Promise<ChangePlan> {
  const changes: PlannedFileChange[] = [];
  const conflicts: string[] = [];
  const warnings: string[] = [];
  const contents = new Map<string, string | null>();

  async function addChange(
    change: InstallChange,
    operation: ChangeOperation,
    resource: string,
    harness: Harness,
  ) {
    const before = contents.has(change.path)
      ? contents.get(change.path) ?? null
      : await currentFile(change.path);
    contents.set(change.path, before);
    const action = classifyChange(before, change.content);
    if (!action) return;

    const existing = changes.find((item) => item.path === change.path);
    if (existing) {
      if (existing.after !== previewContent(change.content)) {
        conflicts.push(`Multiple changes target ${change.path}.`);
      }
      return;
    }

    const planned: PlannedFileChange = {
      path: change.path,
      action,
      resource,
      harness,
      scope: operation.scope,
    };
    const beforePreview = previewContent(before);
    const afterPreview = previewContent(change.content);
    if (beforePreview !== undefined) planned.before = beforePreview;
    if (afterPreview !== undefined) planned.after = afterPreview;
    changes.push(planned);
  }

  const loadedOperations = await Promise.all(
    operations.map(async (operation) => ({
      operation,
      loaded: await snapshot.readResource(operation.resource, operation.version),
    })),
  );
  const installGroups = new Map<string, {
    resources: ResourceVersion[];
    owners: Map<string, ChangeOperation>;
  }>();

  for (const { operation, loaded } of loadedOperations) {
    if (operation.action !== 'install') continue;
    for (const harness of operation.harnesses) {
      const key = `${operation.scope}:${harness}`;
      const group = installGroups.get(key) ?? {
        resources: [] as ResourceVersion[],
        owners: new Map<string, ChangeOperation>(),
      };
      for (const resource of loaded.resources) {
        const id = resourceKey(resource.resource);
        if (!group.owners.has(id)) {
          group.resources.push(resource);
          group.owners.set(id, operation);
        }
      }
      installGroups.set(key, group);
    }
  }

  const processedInstallGroups = new Set<string>();

  for (const { operation, loaded } of loadedOperations) {
    warnings.push(...requestWarnings([loaded.resource, ...loaded.resources]));
    const manifestPath = getInstallManifestPath(operation.scope, cwd);
    const manifest = await readInstallationManifest(manifestPath);
    const resourceIds = loaded.resources.map((item) => resourceKey(item.resource));

    for (const harness of operation.harnesses) {
      const records = manifest.installations.filter(
        (record) =>
          record.scope === operation.scope &&
          record.harness === harness &&
          resourceIds.includes(record.resource),
      );

      for (const record of records) {
        try {
          await assertInstallationFilesUnchanged(record, force);
        } catch (error) {
          conflicts.push(`${record.resource} (${harness}, ${operation.scope}): ${errorMessage(error)}`);
        }
      }

      if (operation.action === 'install') {
        const groupKey = `${operation.scope}:${harness}`;
        if (processedInstallGroups.has(groupKey)) continue;
        processedInstallGroups.add(groupKey);
        const group = installGroups.get(groupKey);
        const installer = getHarnessAdapter(harness);
        const results = await installer.install(
          group?.resources ?? loaded.resources,
          installOptions(operation.scope, { ...options, cwd }, true, true),
        );
        for (const [index, result] of results.entries()) {
          const plannedResource = (group?.resources ?? loaded.resources)[index];
          const resourceId = plannedResource ? resourceKey(plannedResource.resource) : operation.resource;
          const owner = group?.owners.get(resourceId) ?? operation;
          for (const change of result.changes ?? []) {
            await addChange(change, owner, resourceId, harness);
          }

          const previous = manifest.installations.find(
            (record) =>
              record.resource === resourceId &&
              record.harness === harness &&
              record.scope === operation.scope,
          );
          if (previous) {
            const currentPaths = new Set(result.ownedPaths);
            for (const path of previous.files) {
              if (!currentPaths.has(path)) {
                await addChange({ path, content: null }, owner, resourceId, harness);
              }
            }
          }
        }
      } else {
        for (const record of records) {
          const result = await uninstallInstallation(
            record,
            installOptions(operation.scope, { ...options, cwd }, force, true),
          );
          for (const change of result) {
            await addChange(change, operation, record.resource, harness);
          }
        }
      }
    }
  }

  return {
    operations,
    changes,
    conflicts: [...new Set(conflicts)],
    warnings: [...new Set(warnings)],
  };
}

async function applyChangeOperations(
  operations: ChangeOperation[],
  options: ServerOptions,
  cwd: string,
  force: boolean,
  snapshot: RegistrySnapshot,
): Promise<{ installed: InstallationRecord[]; removed: InstallationRecord[]; warnings: string[] }> {
  const installed: InstallationRecord[] = [];
  const removed: InstallationRecord[] = [];
  const warnings: string[] = [];

  for (const operation of operations) {
    const loaded = await snapshot.readResource(operation.resource, operation.version);
    warnings.push(...requestWarnings([loaded.resource, ...loaded.resources]));
    const manifestPath = getInstallManifestPath(operation.scope, cwd);
    const resourceIds = loaded.resources.map((item) => resourceKey(item.resource));

    for (const harness of operation.harnesses) {
      const installer = getHarnessAdapter(harness);
      if (operation.action === 'install') {
        const results = await installer.install(
          loaded.resources,
          installOptions(operation.scope, { ...options, cwd }, true),
        );
        const records = createInstallationRecords(
          loaded.resources,
          results,
          operation.scope,
          installer.harness,
        );
        await saveInstallationRecords(
          manifestPath,
          records,
          installOptions(operation.scope, { ...options, cwd }, force),
        );
        installed.push(...records);
      } else {
        const manifest = await readInstallationManifest(manifestPath);
        const records = manifest.installations.filter(
          (record) =>
            record.scope === operation.scope &&
            record.harness === harness &&
            resourceIds.includes(record.resource),
        );

        for (const record of records) {
          await uninstallInstallation(
            record,
            installOptions(operation.scope, { ...options, cwd }, force),
          );
          await removeInstallationRecord(manifestPath, record);
          removed.push(record);
        }
      }
    }
  }

  return { installed, removed, warnings: [...new Set(warnings)] };
}

async function installationResourceIds(
  resource: string,
  source: RegistrySource,
): Promise<string[]> {
  if (!resource.includes('/templates/')) return [resource];

  const loaded = await readRegistrySourceResource(source, resource);
  return loaded.resources.map((item) => resourceKey(item.resource));
}

async function withRegistrySnapshot<T>(
  options: ServerOptions,
  cwd: string,
  action: (snapshot: RegistrySnapshot) => Promise<T>,
): Promise<T> {
  const snapshot = await createRegistrySnapshot(registrySource(options, cwd));

  try {
    return await action(snapshot);
  } finally {
    await snapshot.close();
  }
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

  app.get('/api/github-user', async (context) => {
    try {
      return context.json({ username: await githubUsername(options, cwd) });
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 503);
    }
  });

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

  app.post('/api/validate', async (context) => {
    let body: Record<string, unknown>;

    try {
      body = await context.req.parseBody({ all: true }) as Record<string, unknown>;
    } catch {
      return context.json({ error: 'Request body must be a valid multipart form.' }, 400);
    }

    const upload = parseResourceUpload(body);
    if (typeof upload === 'string') return context.json({ error: upload }, 400);

    try {
      const result = await withResourceUpload(upload, (sourceDirectory) =>
        validateResourceDirectory({
          sourceDirectory,
          resourceId: upload.resourceId,
          version: upload.version,
          ...(upload.description ? { description: upload.description } : {}),
        }),
      );

      return context.json({
        resource: `${result.resource.owner}/${result.resource.type}/${result.resource.name}`,
        version: upload.version,
        description: result.description,
        entryFile: result.entryFile.path,
        files: result.files.map((file) => file.path),
      });
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 400);
    }
  });

  app.post('/api/submit', async (context) => {
    let body: Record<string, unknown>;

    try {
      body = await context.req.parseBody({ all: true }) as Record<string, unknown>;
    } catch {
      return context.json({ error: 'Request body must be a valid multipart form.' }, 400);
    }

    const upload = parseResourceUpload(body);
    if (typeof upload === 'string') return context.json({ error: upload }, 400);

    try {
      const source = registrySource(options, cwd);
      if (source.type !== 'remote') {
        return context.json(
          { error: 'Website publishing requires a configured Git registry, not a local index.' },
          400,
        );
      }

      const result = await withResourceUpload(upload, (sourceDirectory) =>
        submitResource({
          repositoryUrl: source.repositoryUrl,
          baseBranch: source.baseBranch,
          sourceDirectory,
          resourceId: upload.resourceId,
          version: upload.version,
          ...(upload.description ? { description: upload.description } : {}),
          ...(options.commandRunner ? { commandRunner: options.commandRunner } : {}),
        }),
      );

      return context.json(result);
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 400);
    }
  });

  app.get('/api/installed', async (context) => {
    const requestedScope = context.req.query('scope');

    if (requestedScope !== undefined && !isInstallScope(requestedScope)) {
      return context.json({ error: 'scope must be project or global.' }, 400);
    }

    const scopes: InstallScope[] = requestedScope
      ? [requestedScope]
      : ['project', 'global'];
    const installations = await readInstallationRecords(scopes, cwd);

    return context.json({ installations });
  });

  app.get('/api/local-resources', async (context) => {
    const requestedScope = context.req.query('scope');

    if (requestedScope !== undefined && !isInstallScope(requestedScope)) {
      return context.json({ error: 'scope must be project or global.' }, 400);
    }

    const scopes: InstallScope[] = requestedScope
      ? [requestedScope]
      : ['project', 'global'];

    try {
      const records = await readInstallationRecords(scopes, cwd);
      const resources = await discoverLocalResources({
        cwd,
        ...(options.homeDirectory ? { homeDirectory: options.homeDirectory } : {}),
        ...(options.environment ? { environment: options.environment } : {}),
        scopes,
        records,
      });

      let registryError: string | undefined;
      let enriched = resources;

      if (resources.some((resource) => resource.resource)) {
        try {
          enriched = enrichLocalResources(
            resources,
            await readRegistrySourceIndex(registrySource(options, cwd)),
          );
        } catch (caught) {
          registryError = errorMessage(caught);
        }
      }

      return context.json({
        resources: enriched,
        ...(registryError ? { registryError } : {}),
      });
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 400);
    }
  });

  app.post('/api/plan', async (context) => {
    let body: unknown;

    try {
      body = await jsonBody(context);
    } catch {
      return context.json({ error: 'Request body must be valid JSON.' }, 400);
    }

    const error = changePlanError(body);
    if (error) return context.json({ error }, 400);

    try {
      const request = parseChangeOperations(body);
      const plan = await withRegistrySnapshot(options, cwd, (snapshot) =>
        buildChangePlan(request.operations, options, cwd, request.force, snapshot));
      return context.json(plan);
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 400);
    }
  });

  app.post('/api/apply', async (context) => {
    let body: unknown;

    try {
      body = await jsonBody(context);
    } catch {
      return context.json({ error: 'Request body must be valid JSON.' }, 400);
    }

    const error = changePlanError(body);
    if (error) return context.json({ error }, 400);

    try {
      const request = parseChangeOperations(body);
      const result = await withRegistrySnapshot(options, cwd, async (snapshot) => {
        const plan = await buildChangePlan(request.operations, options, cwd, request.force, snapshot);
        if (plan.conflicts.length > 0 && !request.force) {
          return { conflict: true as const, plan };
        }

        return {
          conflict: false as const,
          plan,
          result: await applyChangeOperations(request.operations, options, cwd, request.force, snapshot),
        };
      });
      if (result.conflict) {
        return context.json({ error: 'The change plan contains conflicts.', ...result.plan }, 409);
      }
      return context.json({ ...result.result, plan: result.plan });
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 400);
    }
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
