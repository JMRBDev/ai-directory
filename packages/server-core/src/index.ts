import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  clearConfigFile,
  getConfigPath,
  getInstallManifestPath,
  getProjectInstallManifestPath,
  getRepositorySetting,
  getScopeInstallManifestPath,
  readConfigFile,
  writeConfigFile,
  type ConfigScope,
} from '@ai-directory/config';
import {
  applyMcpOperations,
  applyResourceOperations,
  assertInstalledFor,
  discoverLocalResources,
  enrichLocalResources,
  errorMessage,
  planMcpOperations,
  planResourceOperations,
  readInstallationManifest,
  type Harness,
  type InstallationManifest,
  type InstallationPackRecord,
  type InstallationRecord,
  type LocalResource,
  type McpOperation,
  type ResourceChangeOptions,
  type ResourceDiscoveryOptions,
  type ResourceOperation,
  type ResourcePackOperation,
  type DependencyCommandRunner,
} from '@ai-directory/installers';
import { harnessSchema, resourceKey } from '@ai-directory/contracts';
import {
  createCachedRegistry,
  readRegistrySourceResource,
  resolveRegistrySource,
  submitResource,
  type CommandRunner,
  type RegistrySnapshot,
  type RegistrySource,
  type RegistrySourceOptions,
  type ResourceDirectoryValidationOptions,
  type SubmitResourceOptions,
  validateResourceDirectory,
} from '@ai-directory/registry';
import { z } from 'zod';

const execFileAsync = promisify(execFile);

export type ServerOptions = {
  cwd?: string;
  homeDirectory?: string;
  registryIndexPath?: string;
  environment?: NodeJS.ProcessEnv;
  commandRunner?: CommandRunner;
  dependencyCommandRunner?: DependencyCommandRunner;
  prewarm?: boolean;
};

type JsonValue = string | boolean | number | null | JsonValue[] | { [key: string]: JsonValue };
type RequestBody = Record<string, JsonValue | undefined>;
type MultipartValue = string | File | Array<string | File>;
type MultipartBody = Record<string, MultipartValue>;

const configScopeSchema = z.enum(['user', 'project']);

const harnessListSchema = z
  .union([
    z.array(harnessSchema),
    z.string(),
  ])
  .transform((value) => {
    const items = Array.isArray(value) ? value : value.split(',').map((item) => item.trim()).filter(Boolean);
    return [...new Set(items)];
  })
  .pipe(z.array(harnessSchema).min(1));

const resourceRequestObjectSchema = z.object({
  resource: z.string().trim().min(1),
  harnesses: harnessListSchema.optional(),
  version: z.string().trim().min(1).optional(),
  scope: configScopeSchema.optional(),
  force: z.boolean().default(false),
});

const resourceRequestWithDependenciesSchema = resourceRequestObjectSchema.extend({
  installDependencies: z.boolean().default(false),
  removeDependencies: z.boolean().default(false),
});

type ResourceRequestData = {
  resource: string;
  harnesses: Harness[];
  version?: string;
  scope?: ConfigScope;
  force: boolean;
  installDependencies: boolean;
  removeDependencies: boolean;
};

function resourceRequestFrom(data: {
  resource: string;
  harnesses?: Harness[] | undefined;
  version?: string | undefined;
  scope?: ConfigScope | undefined;
  force: boolean;
  installDependencies?: boolean | undefined;
  removeDependencies?: boolean | undefined;
}): ResourceRequestData {
  const result: ResourceRequestData = {
    resource: data.resource,
    harnesses: data.harnesses ?? [],
    force: data.force,
    installDependencies: data.installDependencies ?? false,
    removeDependencies: data.removeDependencies ?? false,
  };
  if (data.version !== undefined) result.version = data.version;
  if (data.scope !== undefined) result.scope = data.scope;

  return result;
}

function requireHarnesses(data: { harnesses?: unknown }) {
  return data.harnesses !== undefined;
}

const resourceRequestSchema = resourceRequestWithDependenciesSchema
  .refine(requireHarnesses, {
    message: 'harnesses must include one or more of claude-code, opencode, or codex.',
  })
  .transform(resourceRequestFrom);

type ChangeOperationData = ResourceRequestData & { action: 'install' | 'uninstall' };

const changeOperationSchema = resourceRequestObjectSchema
  .extend({
    action: z.enum(['install', 'uninstall']),
  })
  .refine(requireHarnesses, {
    message: 'harnesses must include one or more of claude-code, opencode, or codex.',
  })
  .transform((data) => ({ ...resourceRequestFrom(data), action: data.action }));

const changePlanRequestSchema = z.object({
  operations: z.array(changeOperationSchema).min(1),
  force: z.boolean().default(false),
  installDependencies: z.boolean().default(false),
  removeDependencies: z.boolean().default(false),
  planFingerprint: z.string().trim().min(1).optional(),
});

type ChangePlanRequestData = z.infer<typeof changePlanRequestSchema>;

const configRequestSchema = z.object({
  repository: z.string().trim().min(1),
  scope: configScopeSchema,
});

interface ResourceUpload {
  resourceId: string;
  version: string;
  description?: string;
  files: File[];
}

interface UploadResult {
  sourceDirectory: string;
  files: string[];
}

function requestErrorMessage(issues: z.ZodIssue[]): string {
  for (const issue of issues) {
    if (issue.code === 'custom') return issue.message;
    const field = issue.path[issue.path.length - 1];
    if (field === 'resource') return 'resource must be a non-empty string.';
    if (field === 'harnesses') {
      return issue.code === 'too_small'
        ? 'harnesses must include one or more of claude-code, opencode, or codex.'
        : 'harnesses must include only claude-code, opencode, or codex.';
    }
    if (field === 'version') {
      return issue.code === 'invalid_type'
        ? 'version must be a string.'
        : 'version must be a non-empty string.';
    }
    if (field === 'force' || field === 'installDependencies' || field === 'removeDependencies') {
      return field + ' must be a boolean.';
    }
  }

  return 'Request body must be a JSON object.';
}

function changePlanErrorMessage(issues: z.ZodIssue[]): string {
  for (const issue of issues) {
    if (issue.code === 'custom') return issue.message;
    if (issue.path.length === 0) return 'Request body must be a JSON object.';
    const field = issue.path[issue.path.length - 1];
    if (issue.path[0] === 'operations' && issue.path.length === 1) {
      return 'operations must include one or more resource changes.';
    }
    if (issue.path[0] === 'operations' && issue.path.length === 2) {
      return 'Each operation must be a JSON object.';
    }
    if (issue.path[0] === 'operations' && field === 'action') {
      return 'Each operation action must be install or uninstall.';
    }
    if (issue.path[0] === 'operations') {
      return requestErrorMessage([issue]);
    }
    if (field === 'force' || field === 'installDependencies' || field === 'removeDependencies') {
      return field + ' must be a boolean.';
    }
    if (field === 'planFingerprint') return 'planFingerprint must be a non-empty string.';
  }

  return 'Request body must be a JSON object.';
}

function requestError(body: RequestBody): string | null {
  const result = resourceRequestSchema.safeParse(body);
  return result.success ? null : requestErrorMessage(result.error.issues);
}

function parseResourceRequest(body: RequestBody): ResourceRequestData {
  return resourceRequestSchema.parse(body);
}

function duplicateOperationError(operations: ChangeOperationData[]): string | null {
  const keys = new Set<string>();
  for (const operation of operations) {
    for (const harness of operation.harnesses) {
      const key = `${harness}:${operation.resource}`;
      if (keys.has(key)) return `The operation is listed more than once: ${key}.`;
      keys.add(key);
    }
  }

  return null;
}

function changePlanError(body: RequestBody): string | null {
  const result = changePlanRequestSchema.safeParse(body);
  if (!result.success) return changePlanErrorMessage(result.error.issues);

  return duplicateOperationError(result.data.operations);
}

function parseChangeOperations(body: RequestBody): ChangePlanRequestData {
  return changePlanRequestSchema.parse(body);
}

function uploadText(body: MultipartBody, key: string): string {
  const value = body[key];
  if (value === undefined || Array.isArray(value) || value instanceof File) return '';
  return value.trim();
}

function uploadFiles(value: MultipartValue): File[] {
  const values = Array.isArray(value) ? value : [value];
  return values.filter((item): item is File => item instanceof File);
}

type ResourceUploadResult = { ok: true; upload: ResourceUpload } | { ok: false; error: string };

function parseResourceUpload(body: MultipartBody): ResourceUploadResult {
  const resourceId = uploadText(body, 'resourceId');
  const version = uploadText(body, 'version');
  const description = uploadText(body, 'description');
  const files = uploadFiles(body['files[]'] ?? body.files ?? []);

  if (!resourceId) return { ok: false, error: 'resourceId must be a non-empty string.' };
  if (!version) return { ok: false, error: 'version must be a non-empty string.' };
  if (files.length === 0) return { ok: false, error: 'files must include a resource directory.' };

  const upload: ResourceUpload = { resourceId, version, files };
  if (description) upload.description = description;

  return { ok: true, upload };
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
  const repositoryValue = getRepositorySetting(undefined, cwd).value;
  const sourceOptions: RegistrySourceOptions = {};
  if (indexPath) sourceOptions.indexPath = indexPath;
  if (repositoryValue) sourceOptions.repositoryUrl = repositoryValue;

  return resolveRegistrySource(sourceOptions);
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

export async function readInstallationRecords(
  homeDirectory?: string,
  cwd?: string,
): Promise<InstallationRecord[]> {
  const manifests = await Promise.all([
    readInstallationManifest(getInstallManifestPath(homeDirectory)),
    readInstallationManifest(getProjectInstallManifestPath(cwd ?? process.cwd())),
  ]);

  return manifests.flatMap((manifest) => manifest.installations);
}

export async function readInstallationPacks(
  homeDirectory?: string,
  cwd?: string,
): Promise<InstallationPackRecord[]> {
  const manifests = await Promise.all([
    readInstallationManifest(getInstallManifestPath(homeDirectory)),
    readInstallationManifest(getProjectInstallManifestPath(cwd ?? process.cwd())),
  ]);

  return manifests.flatMap((manifest) => manifest.packs);
}

export function localResourceFromMcpRecord(record: InstallationRecord): LocalResource {
  const resource: LocalResource = {
    resource: record.resource,
    type: 'mcp-servers',
    name: record.resource.split('/').at(-1) ?? record.resource,
    harness: record.harness,
    path: record.destination,
    files: record.files,
    state: 'managed',
    registryState: 'unknown',
    version: record.version,
  };
  if (record.scope) resource.scope = record.scope;
  return resource;
}

export async function installationResourceIds(
  resource: string,
  source: RegistrySource | undefined,
  manifest?: InstallationManifest,
  harnesses?: Harness[],
): Promise<string[]> {
  if (!resource.includes('/templates/')) return [resource];

  const recorded = manifest?.packs.filter((pack) =>
    pack.resource === resource && (harnesses === undefined || harnesses.includes(pack.harness)),
  ) ?? [];
  if (recorded.length > 0) {
    return [...new Set(recorded.flatMap((pack) => pack.resources.map((entry) => entry.resource)))];
  }

  if (!source) {
    throw new Error('A registry source is required to inspect this template.');
  }

  const loaded = await readRegistrySourceResource(source, resource);
  return loaded.resources.map((item) => resourceKey(item.resource));
}

export function installationPackOperation(
  manifest: InstallationManifest,
  resource: string,
  harness: Harness,
): ResourcePackOperation | undefined {
  const record = manifest.packs.find((pack) =>
    pack.resource === resource && pack.harness === harness,
  );
  if (!record) return undefined;

  return {
    version: record.version,
    resources: record.resources,
  };
}

export function isMcpResource(resource: string): boolean {
  return resource.includes('/mcp-servers/');
}

export function installManifestPath(
  scope: ConfigScope,
  options: ServerOptions = {},
  cwd: string = process.cwd(),
): string {
  return getScopeInstallManifestPath(scope, cwd, options.homeDirectory);
}

const cachedRegistry = createCachedRegistry();

async function withRegistrySnapshot<T>(
  options: ServerOptions,
  cwd: string,
  action: (snapshot: RegistrySnapshot) => Promise<T>,
): Promise<T> {
  const snapshot = await cachedRegistry.get(registrySource(options, cwd));
  return action(snapshot);
}

function changeOptions(
  options: ServerOptions,
  cwd: string,
  scope?: ConfigScope,
  dependencyOptions?: Pick<ResourceChangeOptions, 'installDependencies' | 'removeDependencies'>,
): ResourceChangeOptions {
  const result: ResourceChangeOptions = { cwd };
  if (options.homeDirectory) result.homeDirectory = options.homeDirectory;
  if (options.environment) result.environment = options.environment;
  if (scope) result.scope = scope;
  if (dependencyOptions?.installDependencies !== undefined) {
    result.installDependencies = dependencyOptions.installDependencies;
  }
  if (dependencyOptions?.removeDependencies !== undefined) {
    result.removeDependencies = dependencyOptions.removeDependencies;
  }
  if (options.dependencyCommandRunner) result.dependencyCommandRunner = options.dependencyCommandRunner;

  return result;
}

type PlannedChangeSummary = {
  fingerprint: string;
  conflicts: string[];
};

type ApplyOutcome<T> =
  | { stale: true; conflict: false; plan: PlannedChangeSummary }
  | { stale: false; conflict: true; plan: PlannedChangeSummary }
  | { stale: false; conflict: false; plan: PlannedChangeSummary; result: T };

async function applyPlannedChange<T>(
  planFingerprint: string | undefined,
  force: boolean,
  plan: PlannedChangeSummary,
  apply: () => Promise<T>,
): Promise<ApplyOutcome<T>> {
  if (planFingerprint && planFingerprint !== plan.fingerprint) {
    return { stale: true, conflict: false, plan };
  }
  if (plan.conflicts.length > 0 && !force) {
    return { stale: false, conflict: true, plan };
  }
  return { stale: false, conflict: false, plan, result: await apply() };
}

async function resolveOperations<T extends boolean>(
  operations: ChangeOperationData[],
  snapshot: RegistrySnapshot,
  isMcp: T,
): Promise<T extends true ? McpOperation[] : ResourceOperation[]> {
  const resolved = await Promise.all(operations.map(async (operation) => {
    const loaded = await snapshot.readResource(operation.resource, operation.version);

    if (isMcp) {
      const result: McpOperation = {
        resource: operation.resource,
        harnesses: operation.harnesses,
        action: operation.action,
        resources: loaded.resources,
        warningResources: [loaded.resource, ...loaded.resources],
      };
      if (operation.scope) result.scope = operation.scope;
      if (operation.version !== undefined) result.version = operation.version;
      if (operation.action === 'uninstall') {
        result.resourceIds = loaded.resources.map((item) => resourceKey(item.resource));
      }
      return result;
    }

    const result: ResourceOperation = {
      ...operation,
      resources: loaded.resources,
      warningResources: [loaded.resource, ...loaded.resources],
    };
    if (loaded.resource.resource.type === 'templates') {
      result.pack = {
        version: loaded.resource.version,
        resources: loaded.resources.map((resource) => ({
          resource: resourceKey(resource.resource),
          version: resource.version,
        })),
      } satisfies ResourcePackOperation;
    }
    return result;
  }));

  // SAFETY: The isMcp branch above yields McpOperation entries, the other
  // ResourceOperation entries, so the conditional type matches the data.
  return resolved as T extends true ? McpOperation[] : ResourceOperation[];
}

async function jsonBody(context: { req: { json: <T>() => Promise<T> } }): Promise<RequestBody> {
  return context.req.json<RequestBody>();
}

export function createApp(options: ServerOptions = {}) {
  const app = new Hono();
  const cwd = resolve(options.cwd ?? process.cwd());

  if (options.prewarm) {
    void cachedRegistry.get(registrySource(options, cwd)).catch(() => undefined);
  }

  app.get('/health', (context) => context.json({ ok: true }));
  app.use('/api/*', cors({ origin: '*' }));

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

  app.post('/api/validate', async (context) => {
    let body: MultipartBody;

    try {
      body = await context.req.parseBody<{ all: true }, MultipartBody>({ all: true });
    } catch {
      return context.json({ error: 'Request body must be a valid multipart form.' }, 400);
    }

    const uploadResult = parseResourceUpload(body);
    if (!uploadResult.ok) return context.json({ error: uploadResult.error }, 400);
    const upload = uploadResult.upload;

    try {
      const result = await withResourceUpload(upload, (sourceDirectory) => {
        const options: ResourceDirectoryValidationOptions = {
          sourceDirectory,
          resourceId: upload.resourceId,
          version: upload.version,
        };
        if (upload.description) options.description = upload.description;

        return validateResourceDirectory(options);
      });

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
    let body: MultipartBody;

    try {
      body = await context.req.parseBody<{ all: true }, MultipartBody>({ all: true });
    } catch {
      return context.json({ error: 'Request body must be a valid multipart form.' }, 400);
    }

    const uploadResult = parseResourceUpload(body);
    if (!uploadResult.ok) return context.json({ error: uploadResult.error }, 400);
    const upload = uploadResult.upload;

    try {
      const source = registrySource(options, cwd);
      if (source.type !== 'remote') {
        return context.json(
          { error: 'Website publishing requires a configured Git registry, not a local index.' },
          400,
        );
      }

      const result = await withResourceUpload(upload, (sourceDirectory) => {
        const submitOptions: SubmitResourceOptions = {
          repositoryUrl: source.repositoryUrl,
          baseBranch: source.baseBranch,
          sourceDirectory,
          resourceId: upload.resourceId,
          version: upload.version,
        };
        if (upload.description) submitOptions.description = upload.description;
        if (options.commandRunner) submitOptions.commandRunner = options.commandRunner;

        return submitResource(submitOptions);
      });

      return context.json(result);
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 400);
    }
  });

  app.get('/api/installed', async (context) => {
    const installations = await readInstallationRecords(options.homeDirectory, cwd);

    return context.json({ installations });
  });

  app.get('/api/local-resources', async (context) => {
    try {
      const records = await readInstallationRecords(options.homeDirectory, cwd);
      const discoveryOptions: ResourceDiscoveryOptions = {
        cwd,
        records,
      };
      if (options.homeDirectory) discoveryOptions.homeDirectory = options.homeDirectory;
      if (options.environment) discoveryOptions.environment = options.environment;
      const resources = await discoverLocalResources(discoveryOptions);
      const mcpResources = records
        .filter((record) => record.kind === 'mcp')
        .map(localResourceFromMcpRecord);
      const merged = [...resources, ...mcpResources];

      let registryError: string | undefined;
      let enriched = merged;

      if (merged.some((resource) => resource.resource)) {
        try {
          const snapshot = await cachedRegistry.get(registrySource(options, cwd));
          enriched = enrichLocalResources(merged, await snapshot.readIndex());
        } catch (caught) {
          registryError = errorMessage(caught);
        }
      }

      interface LocalResourcesResponse {
        resources: LocalResource[];
        registryError?: string;
      }

      const response: LocalResourcesResponse = { resources: enriched };
      if (registryError) response.registryError = registryError;

      return context.json(response);
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 400);
    }
  });

  app.post('/api/plan', async (context) => {
    let body: RequestBody;

    try {
      body = await jsonBody(context);
    } catch {
      return context.json({ error: 'Request body must be valid JSON.' }, 400);
    }

    const error = changePlanError(body);
    if (error) return context.json({ error }, 400);

    try {
      const request = parseChangeOperations(body);
      const plan = await withRegistrySnapshot(options, cwd, async (snapshot) => {
        const isMcp = request.operations.some((operation) => isMcpResource(operation.resource));
        if (isMcp && !request.operations.every((operation) => isMcpResource(operation.resource))) {
          throw new Error('A change plan cannot mix MCP servers with file resources.');
        }
        const scope = isMcp ? (request.operations[0]?.scope ?? 'user') : 'user';
        const changeScopeOptions = changeOptions(options, cwd, isMcp ? scope : undefined);

        if (isMcp) {
          return planMcpOperations(
            await resolveOperations(request.operations, snapshot, true),
            changeScopeOptions,
            request.force,
          );
        }

        return planResourceOperations(
          await resolveOperations(request.operations, snapshot, false),
          changeScopeOptions,
          request.force,
        );
      });
      return context.json(plan);
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 400);
    }
  });

  app.post('/api/apply', async (context) => {
    let body: RequestBody;

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
        const isMcp = request.operations.some((operation) => isMcpResource(operation.resource));
        if (isMcp && !request.operations.every((operation) => isMcpResource(operation.resource))) {
          throw new Error('A change plan cannot mix MCP servers with file resources.');
        }
        const scope = isMcp ? (request.operations[0]?.scope ?? 'user') : 'user';
        const changeScopeOptions = changeOptions(options, cwd, isMcp ? scope : undefined);

        if (isMcp) {
          const operations = await resolveOperations(request.operations, snapshot, true);
          const plan = await planMcpOperations(operations, changeScopeOptions, request.force);
          return applyPlannedChange(
            request.planFingerprint,
            request.force,
            plan,
            () => applyMcpOperations(operations, changeScopeOptions, request.force, plan),
          );
        }

        const operations = await resolveOperations(request.operations, snapshot, false);
        const applyOptions = changeOptions(options, cwd, undefined, {
          installDependencies: request.installDependencies,
          removeDependencies: request.removeDependencies,
        });
        const plan = await planResourceOperations(operations, applyOptions, request.force);
        return applyPlannedChange(
          request.planFingerprint,
          request.force,
          plan,
          () => applyResourceOperations(operations, applyOptions, request.force, plan),
        );
      });
      if (result.stale) {
        return context.json({
          error: 'The change plan is outdated. Generate a new preview before applying.',
          ...result.plan,
        }, 409);
      }
      if (result.conflict) {
        return context.json({ error: 'The change plan contains conflicts.', ...result.plan }, 409);
      }
      return context.json({ ...result.result, plan: result.plan });
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 400);
    }
  });

  app.post('/api/install', async (context) => {
    let body: RequestBody;

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
      const isMcp = isMcpResource(request.resource);
      const scope = isMcp ? (request.scope ?? 'user') : 'user';
      const resourceOperation: ResourceOperation = {
        ...request,
        action: 'install' as const,
        resources: loaded.resources,
        warningResources: [loaded.resource, ...loaded.resources],
      };
      if (loaded.resource.resource.type === 'templates') {
        resourceOperation.pack = {
          version: loaded.resource.version,
          resources: loaded.resources.map((resource) => ({
            resource: resourceKey(resource.resource),
            version: resource.version,
          })),
        };
      }
      const resourceOptions = changeOptions(options, cwd, undefined, {
        installDependencies: request.installDependencies,
      });
      const result = isMcp
        ? await applyMcpOperations(
            [{
              resource: request.resource,
              harnesses: request.harnesses,
              action: 'install',
              scope,
              resources: loaded.resources,
              warningResources: [loaded.resource, ...loaded.resources],
            }],
            changeOptions(options, cwd, scope),
            request.force,
        )
        : await applyResourceOperations(
            [resourceOperation],
            resourceOptions,
            request.force,
          );

      return context.json({
        resource: loaded.resource,
        harnesses: request.harnesses,
        records: result.installed,
        warnings: result.warnings,
        dependencies: isMcp || !('dependencies' in result) ? [] : result.dependencies,
      });
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 400);
    }
  });

  app.post('/api/update', async (context) => {
    let body: RequestBody;

    try {
      body = await jsonBody(context);
    } catch {
      return context.json({ error: 'Request body must be valid JSON.' }, 400);
    }

    const error = requestError(body);
    if (error) return context.json({ error }, 400);

    try {
      const request = parseResourceRequest(body);
      const isMcp = isMcpResource(request.resource);
      const scope = isMcp ? (request.scope ?? 'user') : 'user';
      const manifest = await readInstallationManifest(
        installManifestPath(scope, options, cwd),
      );
      const loaded = await readRegistrySourceResource(
        registrySource(options, cwd),
        request.resource,
      );
      const existing = request.harnesses.map((harness) =>
        loaded.resources.map((resource) =>
          manifest.installations.find(
            (record) =>
              record.resource === resourceKey(resource.resource) &&
              record.harness === harness,
          ),
        ),
      );

      assertInstalledFor(
        manifest,
        loaded.resources.map((resource) => resourceKey(resource.resource)),
        request.harnesses,
        request.resource,
      );

      const existingRecords = existing.flatMap((records) =>
        records.filter(
          (record): record is NonNullable<typeof record> => record !== undefined,
        ),
      );

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

      const resourceOperation: ResourceOperation = {
        ...request,
        harnesses: updatedHarnesses,
        action: 'install' as const,
        resources: loaded.resources,
        warningResources: [loaded.resource, ...loaded.resources],
      };
      if (loaded.resource.resource.type === 'templates') {
        resourceOperation.pack = {
          version: loaded.resource.version,
          resources: loaded.resources.map((resource) => ({
            resource: resourceKey(resource.resource),
            version: resource.version,
          })),
        };
      }
      const resourceOptions = changeOptions(options, cwd, undefined, {
        installDependencies: request.installDependencies,
      });
      const result = isMcp
        ? await applyMcpOperations(
            [{
              resource: request.resource,
              harnesses: updatedHarnesses,
              action: 'install',
              scope,
              resources: loaded.resources,
              warningResources: [loaded.resource, ...loaded.resources],
            }],
            changeOptions(options, cwd, scope),
            request.force,
        )
        : await applyResourceOperations(
            [resourceOperation],
            resourceOptions,
            request.force,
          );

      return context.json({
        updated: true,
        harnesses: updatedHarnesses,
        records: result.installed,
        warnings: result.warnings,
        dependencies: isMcp || !('dependencies' in result) ? [] : result.dependencies,
      });
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 400);
    }
  });

  app.delete('/api/installed', async (context) => {
    const rawRequest = {
      resource: context.req.query('resource'),
      harnesses: context.req.query('harnesses'),
      force: queryBoolean(context.req.query('force')),
      removeDependencies: queryBoolean(context.req.query('removeDependencies')),
    };
    const error = requestError(rawRequest);

    if (error) return context.json({ error }, 400);

    try {
      const request = parseResourceRequest(rawRequest);
      const isMcp = isMcpResource(request.resource);
      const scope = isMcp ? (request.scope ?? 'user') : 'user';
      const manifest = await readInstallationManifest(
        installManifestPath(scope, options, cwd),
      );
      const source = registrySource(options, cwd);
      const resourceIds = await installationResourceIds(
        request.resource,
        source,
        manifest,
        request.harnesses,
      );

      const result = isMcp
        ? await applyMcpOperations(
            [{
              resource: request.resource,
              harnesses: request.harnesses,
              action: 'uninstall',
              resourceIds,
              scope,
            }],
            changeOptions(options, cwd, scope),
            request.force,
          )
        : await (async () => {
            const operations: ResourceOperation[] = [];
            for (const harness of request.harnesses) {
              const resourceIds = await installationResourceIds(
                request.resource,
                source,
                manifest,
                [harness],
              );
              assertInstalledFor(manifest, resourceIds, [harness], request.resource);
              const operation: ResourceOperation = {
                ...request,
                harnesses: [harness],
                action: 'uninstall',
                resourceIds,
              };
              const pack = installationPackOperation(manifest, request.resource, harness);
              if (pack) operation.pack = pack;
              operations.push(operation);
            }

            return applyResourceOperations(
              operations,
              changeOptions(options, cwd, undefined, {
                removeDependencies: request.removeDependencies,
              }),
              request.force,
            );
          })();

      return context.json({
        removed: result.removed,
        removedDependencies: isMcp || !('removedDependencies' in result) ? [] : result.removedDependencies,
        dependencyRemovals: isMcp || !('dependencyRemovals' in result) ? [] : result.dependencyRemovals,
        harnesses: request.harnesses,
      });
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
