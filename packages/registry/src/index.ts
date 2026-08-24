import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import {
  PLUGIN_ENTRY_FILES,
  detectResourceRoots,
  mcpServerManifestSchema,
  pluginManifestSchema,
  registryIndexSchema,
  resourceEntryFiles,
  resourceIdSchema,
  resourceVersionSchema,
  toolManifestSchema,
  templateManifestSchema,
  type DetectedResource,
  type McpServerManifest,
  type PluginManifest,
  type ResourceType,
  type ResourceSummary,
  type RegistryIndex,
  type TemplateManifest,
  type ToolManifest,
} from '@ai-directory/contracts';
import { resourceKey } from '@ai-directory/contracts';
import {
  isMissingPathError,
  listFilesUnder,
  pathExists,
  writeFileAtomic,
} from '@ai-directory/config';
import { gt as isGreaterVersion, valid as isValidVersion } from 'semver';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export type ResourceFile = {
  path: string;
  content: string;
};

export type ResourceVersion = {
  resource: ResourceSummary;
  version: string;
  files: ResourceFile[];
};

export type RemoteResourceOptions = {
  repositoryUrl: string;
  resourceId: string;
  version?: string;
  baseBranch?: string;
  commandRunner?: CommandRunner;
};

export type RemoteRegistryOptions = {
  repositoryUrl: string;
  baseBranch?: string;
  commandRunner?: CommandRunner;
};

export type RegistrySource =
  | { type: 'local'; indexPath: string }
  | { type: 'remote'; repositoryUrl: string; baseBranch: string };

export type RegistrySnapshot = {
  source: RegistrySource;
  indexPath: string;
  readIndex(): Promise<RegistryIndex>;
  readResource(resourceId: string, version?: string): Promise<RemoteResourceResult>;
  close(): Promise<void>;
};

export type RemoteResourceResult = {
  resource: ResourceVersion;
  resources: ResourceVersion[];
};

export type RegistryValidationResult = {
  resourceCount: number;
  issues: string[];
};

export type PublishResourceOptions = {
  indexPath: string;
  sourceDirectory: string;
  resourceId: string;
  version: string;
  description?: string;
};

export type PublishResourceResult = {
  resource: ResourceSummary;
  packageDirectory: string;
  files: string[];
};

export interface ResourceDirectoryValidationOptions {
  sourceDirectory: string;
  resourceId: string;
  version: string;
  description?: string;
}

export type ResourceDirectoryValidationResult = {
  sourceDirectory: string;
  resource: Pick<ResourceSummary, 'owner' | 'type' | 'name'>;
  entryFile: ResourceFile;
  files: ResourceFile[];
  description: string;
};

export type CommandResult = {
  stdout: string;
  stderr: string;
};

export type CommandRunner = (
  command: string,
  args: string[],
  cwd: string,
) => Promise<CommandResult>;

export type SubmitResourceOptions = Omit<PublishResourceOptions, 'indexPath'> & {
  indexPath?: string;
  repositoryUrl?: string;
  baseBranch?: string;
  branch?: string;
  remote?: string;
  title?: string;
  body?: string;
  commandRunner?: CommandRunner;
};

export type SubmitResourceResult = {
  resource: ResourceSummary;
  branch: string;
  commit: string;
  pullRequestUrl: string;
  files: string[];
};

const execFileAsync = promisify(execFile);

const yamlMetadataSchema = z.object({
  description: z.string().optional(),
});

function oneLine(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

export function inferResourceDescription(content: string): string | undefined {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);

  if (frontmatter) {
    try {
      const result = yamlMetadataSchema.safeParse(parseYaml(frontmatter[1] ?? ''));
      const description = result.success ? result.data.description?.trim() : undefined;
      if (description) return oneLine(description);
    } catch {
      // The resource validator reports malformed template frontmatter separately.
    }
  }

  const body = frontmatter ? content.slice(frontmatter[0].length) : content;
  const blocks = body
    .split(/\n\s*\n/u)
    .map((block) => oneLine(block))
    .filter((block) => block && !block.startsWith('#') && !block.startsWith('```'));

  if (blocks[0]) return blocks[0];

  const heading = body.match(/^\s*#{1,6}\s+(.+)$/mu)?.[1];
  return heading ? oneLine(heading) : undefined;
}

export async function readRegistryIndex(filePath: string): Promise<RegistryIndex> {
  let contents: string;

  try {
    contents = await readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Registry index not found: ${filePath}`, { cause: error });
  }

  let data: unknown;

  try {
    data = JSON.parse(contents);
  } catch (error) {
    throw new Error(`Registry index is not valid JSON: ${filePath}`, { cause: error });
  }

  const result = registryIndexSchema.safeParse(data);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'index'}: ${issue.message}`)
      .join('; ');

    throw new Error(`Registry index is invalid (${filePath}): ${issues}`);
  }

  return result.data;
}

export async function readResourceVersion(
  indexPath: string,
  resourceId: string,
  requestedVersion?: string,
): Promise<ResourceVersion> {
  const { resource, version } = await findResourceVersion(indexPath, resourceId, requestedVersion);

  const directory = resourceDirectory(dirname(await realpath(indexPath)), resource, version);

  let files: ResourceFile[];

  try {
    const paths = await listFilesUnder(directory);
    files = await Promise.all(
      paths.map(async (path) => ({
        path: relative(directory, path),
        content: await readFile(path, 'utf8'),
      })),
    );
  } catch (error) {
    if (isMissingPathError(error)) {
      throw new Error(`Resource version not found: ${resourceId}@${version}`, { cause: error });
    }

    throw new Error(`Could not read resource version: ${resourceId}@${version}`, { cause: error });
  }

  if (files.length === 0) {
    throw new Error(`Resource version is empty: ${resourceId}@${version}`);
  }

  return { resource, version, files };
}

export async function readRemoteRegistryIndex(
  options: RemoteRegistryOptions,
): Promise<RegistryIndex> {
  const snapshot = await createRegistrySnapshot(
    {
      type: 'remote',
      repositoryUrl: options.repositoryUrl,
      baseBranch: options.baseBranch ?? 'main',
    },
    options.commandRunner,
  );

  try {
    return await snapshot.readIndex();
  } finally {
    await snapshot.close();
  }
}

export async function validateRemoteRegistry(
  options: RemoteRegistryOptions,
): Promise<RegistryValidationResult> {
  const index = await readRemoteRegistryIndex(options);

  return validateResourceIndex(index, async (resource) => {
    const resourceOptions: RemoteResourceOptions = {
      repositoryUrl: options.repositoryUrl,
      resourceId: resourceKey(resource),
      version: resource.latestVersion,
    };
    if (options.baseBranch) resourceOptions.baseBranch = options.baseBranch;
    if (options.commandRunner) resourceOptions.commandRunner = options.commandRunner;

    return (await readRemoteResource(resourceOptions)).resource;
  });
}

export async function readRemoteResource(
  options: RemoteResourceOptions,
): Promise<RemoteResourceResult> {
  const snapshot = await createRegistrySnapshot(
    {
      type: 'remote',
      repositoryUrl: options.repositoryUrl,
      baseBranch: options.baseBranch ?? 'main',
    },
    options.commandRunner,
  );

  try {
    return await snapshot.readResource(options.resourceId, options.version);
  } finally {
    await snapshot.close();
  }
}

export async function createRegistrySnapshot(
  source: RegistrySource,
  commandRunner = runCommand,
): Promise<RegistrySnapshot> {
  if (source.type === 'local') {
    return {
      source,
      indexPath: source.indexPath,
      readIndex: () => readRegistryIndex(source.indexPath),
      readResource: async (resourceId, version) => {
        const resource = await readResourceVersion(source.indexPath, resourceId, version);

        return {
          resource,
          resources:
            resource.resource.type === 'templates'
              ? await readTemplateResources(source.indexPath, resource)
              : [resource],
        };
      },
      close: async () => undefined,
    };
  }

  const temporaryRepository = await mkdtemp(join(tmpdir(), 'ai-directory-snapshot-'));

  try {
    await clonePartialRepository(
      commandRunner,
      source.repositoryUrl,
      temporaryRepository,
      source.baseBranch,
    );

    return createRemoteRegistrySnapshot(source, temporaryRepository, commandRunner);
  } catch (error) {
    await rm(temporaryRepository, { recursive: true, force: true });
    throw error;
  }
}

function createRemoteRegistrySnapshot(
  source: Extract<RegistrySource, { type: 'remote' }>,
  repositoryRoot: string,
  runner: CommandRunner,
): RegistrySnapshot {
  const indexPath = join(repositoryRoot, 'index.json');
  const patterns = new Set(['index.json']);
  let sparseUpdate = Promise.resolve();
  let closed = false;
  let closePromise: Promise<void> | undefined;

  async function ensurePaths(paths: string[]): Promise<void> {
    if (closed) throw new Error('Registry snapshot is closed.');

    for (const path of paths) patterns.add(path);

    sparseUpdate = sparseUpdate.then(() =>
      setSparseCheckout(runner, repositoryRoot, [...patterns]),
    );
    await sparseUpdate;
  }

  async function readResource(resourceId: string, version?: string): Promise<RemoteResourceResult> {
    const target = await findResourceVersion(indexPath, resourceId, version);
    const targetPattern = resourcePackagePath(target.resource, target.version);

    await ensurePaths([targetPattern]);
    const resource = await readResourceVersion(indexPath, resourceId, target.version);

    if (resource.resource.type !== 'templates') {
      return { resource, resources: [resource] };
    }

    const manifest = readTemplateManifest(resource);
    const dependencies = await Promise.all(
      manifest.resources.map((dependency) =>
        findResourceVersion(indexPath, dependency.id, dependency.version),
      ),
    );

    await ensurePaths(
      dependencies.map((dependency) =>
        resourcePackagePath(dependency.resource, dependency.version),
      ),
    );

    const resources = await Promise.all(
      dependencies.map((dependency) =>
        readResourceVersion(indexPath, resourceKey(dependency.resource), dependency.version),
      ),
    );

    return { resource, resources };
  }

  return {
    source,
    indexPath,
    readIndex: () => readRegistryIndex(indexPath),
    readResource,
    close: async () => {
      if (closePromise) return closePromise;

      closed = true;
      closePromise = sparseUpdate
        .catch(() => undefined)
        .then(() => rm(repositoryRoot, { recursive: true, force: true }));
      return closePromise;
    },
  };
}

export interface RegistrySourceOptions {
  indexPath?: string;
  repositoryUrl?: string;
  baseBranch?: string;
}

export function resolveRegistrySource(options: RegistrySourceOptions): RegistrySource {
  if (options.indexPath?.trim()) {
    return { type: 'local', indexPath: options.indexPath.trim() };
  }

  if (options.repositoryUrl?.trim()) {
    return {
      type: 'remote',
      repositoryUrl: options.repositoryUrl.trim(),
      baseBranch: options.baseBranch?.trim() || 'main',
    };
  }

  throw new Error('No registry source configured. Run `aid setup` or pass `--index <path>`.');
}

export type CachedRegistry = {
  get(source: RegistrySource): Promise<RegistrySnapshot>;
  refresh(): Promise<void>;
};

export function createCachedRegistry(): CachedRegistry {
  let cached: { key: string; promise: Promise<RegistrySnapshot> } | undefined;

  return {
    get(source) {
      const key = source.type === 'remote'
        ? `remote\0${source.repositoryUrl}\0${source.baseBranch}`
        : `local\0${source.indexPath}`;

      if (cached?.key === key) return cached.promise;

      const previous = cached;
      const promise = createRegistrySnapshot(source);

      cached = { key, promise };

      if (previous) {
        void previous.promise.then(
          (snapshot) => snapshot.close(),
          () => undefined,
        );
      }

      promise.catch(() => {
        if (cached?.promise === promise) cached = undefined;
      });

      return promise;
    },
    async refresh() {
      const previous = cached;
      cached = undefined;

      if (previous) {
        await previous.promise.then(
          (snapshot) => snapshot.close(),
          () => undefined,
        );
      }
    },
  };
}

export function readRegistrySourceIndex(source: RegistrySource): Promise<RegistryIndex> {
  return source.type === 'local'
    ? readRegistryIndex(source.indexPath)
    : readRemoteRegistryIndex({
        repositoryUrl: source.repositoryUrl,
        baseBranch: source.baseBranch,
    });
}

export function isResourceVersionOutdated(
  currentVersion: string,
  latestVersion: string,
): boolean {
  return isValidVersion(currentVersion) !== null
    && isValidVersion(latestVersion) !== null
    && isGreaterVersion(latestVersion, currentVersion);
}

export function readRegistrySourceResource(
  source: RegistrySource,
  resourceId: string,
  version?: string,
): Promise<RemoteResourceResult> {
  if (source.type === 'remote') {
    const options: RemoteResourceOptions = {
      repositoryUrl: source.repositoryUrl,
      resourceId,
      baseBranch: source.baseBranch,
    };
    if (version !== undefined) options.version = version;

    return readRemoteResource(options);
  }

  return readResourceVersion(source.indexPath, resourceId, version).then(async (resource) => ({
    resource,
    resources:
      resource.resource.type === 'templates'
        ? await readTemplateResources(source.indexPath, resource)
        : [resource],
  }));
}

export function validateRegistrySource(source: RegistrySource): Promise<RegistryValidationResult> {
  return source.type === 'local'
    ? validateRegistry(source.indexPath)
    : validateRemoteRegistry({
        repositoryUrl: source.repositoryUrl,
        baseBranch: source.baseBranch,
      });
}

export async function publishResource(
  options: PublishResourceOptions,
): Promise<PublishResourceResult> {
  const validationOptions: ResourceDirectoryValidationOptions = {
    sourceDirectory: options.sourceDirectory,
    resourceId: options.resourceId,
    version: options.version,
  };
  if (options.description) validationOptions.description = options.description;

  const validation = await validateResourceDirectory(validationOptions);
  const identity = validation.resource;
  const description = validation.description;
  const index = await readRegistryIndex(options.indexPath);
  const current = index.resources.find((resource) => resourceKey(resource) === options.resourceId);

  if (current) {
    if (!isValidVersion(current.latestVersion)) {
      throw new Error(`Current resource version is invalid: ${current.latestVersion}`);
    }

    if (!isGreaterVersion(options.version, current.latestVersion)) {
      throw new Error(
        `Version must be greater than the current version ${current.latestVersion}: ${options.version}`,
      );
    }
  }

  const registryIndexPath = await resolveDirectory(options.indexPath, 'Registry index');
  const packageDirectory = resourceDirectory(
    dirname(registryIndexPath),
    identity,
    options.version,
  );

  if (await pathExists(packageDirectory)) {
    throw new Error(`Resource version already exists: ${options.resourceId}@${options.version}`);
  }

  await writeResourceFiles(packageDirectory, validation.files);

  const resource: ResourceSummary = current
    ? {
        ...current,
        description,
        latestVersion: options.version,
        reviewStatus: 'unreviewed',
        updatedAt: new Date().toISOString(),
      }
    : {
        ...identity,
        description,
        latestVersion: options.version,
        reviewStatus: 'unreviewed',
        lifecycleStatus: 'active',
        visibility: 'public',
        updatedAt: new Date().toISOString(),
      };

  const nextIndex: RegistryIndex = {
    ...index,
    resources: current
      ? index.resources.map((candidate) =>
          resourceKey(candidate) === options.resourceId ? resource : candidate,
        )
      : [...index.resources, resource],
  };

  await writeRegistryIndex(registryIndexPath, nextIndex);

  return {
    resource,
    packageDirectory,
    files: validation.files.map((file) => file.path),
  };
}

export async function validateResourceDirectory(
  options: ResourceDirectoryValidationOptions,
): Promise<ResourceDirectoryValidationResult> {
  if (!resourceIdSchema.safeParse(options.resourceId).success) {
    throw new Error(`Invalid resource ID: ${options.resourceId}`);
  }

  if (
    !resourceVersionSchema.safeParse(options.version).success ||
    !isValidVersion(options.version)
  ) {
    throw new Error(`Invalid resource version: ${options.version}`);
  }

  const resource = parseResourceId(options.resourceId);
  const sourceDirectory = await resolveDirectory(options.sourceDirectory, 'Resource source directory');
  const paths = await listFilesUnder(sourceDirectory);
  const files = await Promise.all(
    paths.map(async (path) => ({
      path: relative(sourceDirectory, path),
      content: await readFile(path, 'utf8'),
    })),
  );
  const entryFile = files.find((file) => resourceEntryFiles(resource.type).includes(file.path));

  if (!entryFile) {
    const expected = resourceEntryFiles(resource.type).join(' or ');
    const candidates = detectResourceRoots(files.map((file) => file.path), basename(sourceDirectory));
    const findings = candidates
      .map((candidate) => `${candidate.root || '.'} (${candidate.entryFile}, ${candidate.type})`)
      .join(', ');

    throw new Error(
      findings
        ? `${options.resourceId}@${options.version} is missing ${expected}. The folder contains other resources: ${findings}. Publish each one from its own folder.`
        : `${options.resourceId}@${options.version} is missing ${expected}`,
    );
  }

  if (!entryFile.content.trim()) {
    throw new Error(`${options.resourceId}@${options.version} has an empty ${entryFile.path}`);
  }

  const resourceVersion: ResourceVersion = {
    resource: {
      ...resource,
      description: 'Local resource validation',
      latestVersion: options.version,
      reviewStatus: 'unreviewed',
      lifecycleStatus: 'active',
      visibility: 'public',
      updatedAt: 'local',
    },
    version: options.version,
    files,
  };

  const description = options.description?.trim()
    || (resource.type === 'plugins'
      ? readPluginManifest(resourceVersion).manifest.description
      : resource.type === 'tools'
        ? readToolManifest(resourceVersion).description
        : inferResourceDescription(entryFile.content));
  if (!description) {
    throw new Error(
      `${options.resourceId}@${options.version} has no usable description. Add a description to ${entryFile.path} or pass one explicitly.`,
    );
  }

  if (resource.type === 'templates') {
    readTemplateManifest(resourceVersion);
  }

  if (resource.type === 'mcp-servers') {
    readMcpServerManifest(resourceVersion);
  }

  if (resource.type === 'plugins') {
    readPluginManifest(resourceVersion);
  }

  if (resource.type === 'tools') {
    readToolManifest(resourceVersion);
  }

  return { sourceDirectory, resource, entryFile, files, description };
}

export async function detectResourceCandidates(
  sourceDirectory: string,
): Promise<DetectedResource[]> {
  const resolved = await resolveDirectory(sourceDirectory, 'Resource source directory');
  const paths = await listFilesUnder(resolved);
  const relativePaths = paths.map((path) => relative(resolved, path));

  return detectResourceRoots(relativePaths, basename(resolved));
}

export async function submitResource(
  options: SubmitResourceOptions,
): Promise<SubmitResourceResult> {
  if (options.repositoryUrl) {
    const temporaryRepository = await mkdtemp(join(tmpdir(), 'ai-directory-submit-'));
    const runner = options.commandRunner ?? runCommand;

    try {
      await clonePartialRepository(
        runner,
        options.repositoryUrl,
        temporaryRepository,
        options.baseBranch ?? 'main',
      );

      return await submitResourceInCheckout({
        ...options,
        indexPath: join(temporaryRepository, 'index.json'),
      });
    } finally {
      await rm(temporaryRepository, { recursive: true, force: true });
    }
  }

  const indexPath = options.indexPath;

  if (!indexPath) {
    throw new Error('Local submission requires an index path. Pass `--index <path>`.');
  }

  return submitResourceInCheckout({ ...options, indexPath });
}

async function submitResourceInCheckout(
  options: SubmitResourceOptions & { indexPath: string },
): Promise<SubmitResourceResult> {
  if (!resourceIdSchema.safeParse(options.resourceId).success) {
    throw new Error(`Invalid resource ID: ${options.resourceId}`);
  }

  const registryIndexPath = await resolveDirectory(options.indexPath, 'Registry index');
  const registryRoot = dirname(registryIndexPath);
  const runner = options.commandRunner ?? runCommand;
  const baseBranch = options.baseBranch ?? 'main';
  const remote = options.remote ?? 'origin';
  const branch =
    options.branch ?? `submit/${options.resourceId.replaceAll('/', '-')}-${options.version}`;

  const status = await executeCommand(
    runner,
    'git',
    ['status', '--porcelain', '--untracked-files=all'],
    registryRoot,
  );

  if (status.stdout.trim()) {
    throw new Error('Registry working tree is not clean. Commit or stash existing changes first.');
  }

  const currentBranch = await executeCommand(
    runner,
    'git',
    ['branch', '--show-current'],
    registryRoot,
  );

  if (currentBranch.stdout.trim() !== baseBranch) {
    throw new Error(
      `Registry must be checked out on ${baseBranch}; found ${currentBranch.stdout.trim() || 'detached HEAD'}.`,
    );
  }

  await executeCommand(runner, 'git', ['remote', 'get-url', remote], registryRoot);
  await executeCommand(runner, 'gh', ['auth', 'status'], registryRoot);
  await executeCommand(runner, 'git', ['switch', '-c', branch], registryRoot);

  try {
    const published = await publishResource(options);
    const indexFile = relative(registryRoot, registryIndexPath);
    const packageDirectory = relative(registryRoot, published.packageDirectory);

    await executeCommand(
      runner,
      'git',
      ['add', '--sparse', '--', indexFile, packageDirectory],
      registryRoot,
    );
    await executeCommand(
      runner,
      'git',
      [
        'commit',
        '-m',
        `Submit ${resourceKey(published.resource)}@${published.resource.latestVersion}`,
      ],
      registryRoot,
    );

    const commit = await executeCommand(runner, 'git', ['rev-parse', 'HEAD'], registryRoot);
    await executeCommand(runner, 'git', ['push', '--set-upstream', remote, branch], registryRoot);

    const pullRequest = await executeCommand(
      runner,
      'gh',
      [
        'pr',
        'create',
        '--base',
        baseBranch,
        '--head',
        branch,
        '--title',
        options.title ?? `Submit ${resourceKey(published.resource)}@${published.resource.latestVersion}`,
        '--body',
        options.body ?? defaultPullRequestBody(published.resource),
      ],
      registryRoot,
    );
    const pullRequestUrl = pullRequest.stdout.trim();

    if (!pullRequestUrl) {
      throw new Error('GitHub CLI did not return a pull request URL.');
    }

    return {
      resource: published.resource,
      branch,
      commit: commit.stdout.trim(),
      pullRequestUrl,
      files: published.files,
    };
  } catch (error) {
    throw new Error(
      `Submission branch ${branch} was created, but the pull request was not completed: ${error instanceof Error ? error.message : error}`,
      { cause: error },
    );
  }
}

async function clonePartialRepository(
  runner: CommandRunner,
  repositoryUrl: string,
  destination: string,
  baseBranch: string,
): Promise<void> {
  await executeCommand(
    runner,
    'git',
    ['clone', '--filter=blob:none', '--no-checkout', '--branch', baseBranch, repositoryUrl, destination],
    dirname(destination),
  );
  await executeCommand(runner, 'git', ['sparse-checkout', 'init', '--no-cone'], destination);
  await setSparseCheckout(runner, destination, ['index.json']);
  await executeCommand(runner, 'git', ['checkout', baseBranch], destination);
}

async function setSparseCheckout(
  runner: CommandRunner,
  destination: string,
  patterns: string[],
): Promise<void> {
  await executeCommand(runner, 'git', ['sparse-checkout', 'set', ...patterns], destination);
}

async function findResourceVersion(
  indexPath: string,
  requestedResourceId: string,
  requestedVersion?: string,
): Promise<{ resource: ResourceSummary; version: string }> {
  if (!resourceIdSchema.safeParse(requestedResourceId).success) {
    throw new Error(`Invalid resource ID: ${requestedResourceId}`);
  }

  const index = await readRegistryIndex(indexPath);
  const resource = index.resources.find((candidate) => resourceKey(candidate) === requestedResourceId);

  if (!resource) {
    throw new Error(`Resource not found: ${requestedResourceId}`);
  }

  const version = requestedVersion ?? resource.latestVersion;

  if (!resourceVersionSchema.safeParse(version).success) {
    throw new Error(`Invalid resource version: ${version}`);
  }

  return { resource, version };
}

export function readTemplateManifest(resource: ResourceVersion): TemplateManifest {
  if (resource.resource.type !== 'templates') {
    throw new Error(`Resource is not a template: ${resourceKey(resource.resource)}`);
  }

  const templateFile = resource.files.find((file) => file.path === 'TEMPLATE.md');

  if (!templateFile) {
    throw new Error(`Template is missing TEMPLATE.md: ${resourceKey(resource.resource)}`);
  }

  const frontmatter = templateFile.content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);

  if (!frontmatter) {
    throw new Error(
      `Template manifest is missing YAML frontmatter: ${resourceKey(resource.resource)}@${resource.version}`,
    );
  }

  let data: unknown;
  const yaml = frontmatter[1] ?? '';

  try {
    data = parseYaml(yaml);
  } catch (error) {
    throw new Error(
      `Template manifest is not valid YAML: ${resourceKey(resource.resource)}@${resource.version}`,
      { cause: error },
    );
  }

  const result = templateManifestSchema.safeParse(data);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'manifest'}: ${issue.message}`)
      .join('; ');

    throw new Error(
      `Template manifest is invalid (${resourceKey(resource.resource)}@${resource.version}): ${issues}`,
    );
  }

  if (result.data.name !== resource.resource.name) {
    throw new Error(
      `Template manifest name does not match resource name: ${result.data.name} !== ${resource.resource.name}`,
    );
  }

  return result.data;
}

export function readMcpServerManifest(resource: ResourceVersion): McpServerManifest {
  if (resource.resource.type !== 'mcp-servers') {
    throw new Error(`Resource is not an MCP server: ${resourceKey(resource.resource)}`);
  }

  const entryFile = resource.files.find((file) => file.path === 'MCP.md');

  if (!entryFile) {
    throw new Error(`MCP server is missing MCP.md: ${resourceKey(resource.resource)}`);
  }

  const frontmatter = entryFile.content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);

  if (!frontmatter) {
    throw new Error(
      `MCP manifest is missing YAML frontmatter: ${resourceKey(resource.resource)}@${resource.version}`,
    );
  }

  let data: unknown;
  const yaml = frontmatter[1] ?? '';

  try {
    data = parseYaml(yaml);
  } catch (error) {
    throw new Error(
      `MCP manifest is not valid YAML: ${resourceKey(resource.resource)}@${resource.version}`,
      { cause: error },
    );
  }

  const result = mcpServerManifestSchema.safeParse(data);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'manifest'}: ${issue.message}`)
      .join('; ');

    throw new Error(
      `MCP manifest is invalid (${resourceKey(resource.resource)}@${resource.version}): ${issues}`,
    );
  }

  if (result.data.name !== resource.resource.name) {
    throw new Error(
      `MCP manifest name does not match resource name: ${result.data.name} !== ${resource.resource.name}`,
    );
  }

  return result.data;
}

export function readToolManifest(resource: ResourceVersion): ToolManifest {
  if (resource.resource.type !== 'tools') {
    throw new Error(`Resource is not a tool: ${resourceKey(resource.resource)}`);
  }

  const entryFile = resource.files.find((file) => file.path === 'TOOL.md');

  if (!entryFile) {
    throw new Error(`Tool is missing TOOL.md: ${resourceKey(resource.resource)}`);
  }

  const frontmatter = entryFile.content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);

  if (!frontmatter) {
    throw new Error(
      `Tool manifest is missing YAML frontmatter: ${resourceKey(resource.resource)}@${resource.version}`,
    );
  }

  let data: unknown;
  const yaml = frontmatter[1] ?? '';

  try {
    data = parseYaml(yaml);
  } catch (error) {
    throw new Error(
      `Tool manifest is not valid YAML: ${resourceKey(resource.resource)}@${resource.version}`,
      { cause: error },
    );
  }

  const result = toolManifestSchema.safeParse(data);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'manifest'}: ${issue.message}`)
      .join('; ');

    throw new Error(
      `Tool manifest is invalid (${resourceKey(resource.resource)}@${resource.version}): ${issues}`,
    );
  }

  if (result.data.name !== resource.resource.name) {
    throw new Error(
      `Tool manifest name does not match resource name: ${result.data.name} !== ${resource.resource.name}`,
    );
  }

  const missingExecutables = result.data.executables.filter(
    (path) => !resource.files.some((file) => file.path === path),
  );

  if (missingExecutables.length > 0) {
    throw new Error(
      `Tool manifest lists missing executable file(s): ${missingExecutables.join(', ')}`,
    );
  }

  return result.data;
}

export type PluginManifestResult = {
  file: ResourceFile;
  manifest: PluginManifest;
};

export function readPluginManifest(resource: ResourceVersion): PluginManifestResult {
  if (resource.resource.type !== 'plugins') {
    throw new Error(`Resource is not a plugin: ${resourceKey(resource.resource)}`);
  }

  const entryFile = resource.files.find((file) =>
    PLUGIN_ENTRY_FILES.some((entry) => entry === file.path),
  );

  if (!entryFile) {
    throw new Error(
      `Plugin is missing a manifest (${PLUGIN_ENTRY_FILES.join(' or ')}): ${resourceKey(resource.resource)}`,
    );
  }

  let data: unknown;

  try {
    data = JSON.parse(entryFile.content);
  } catch (error) {
    throw new Error(
      `Plugin manifest is not valid JSON: ${resourceKey(resource.resource)}@${resource.version}`,
      { cause: error },
    );
  }

  const result = pluginManifestSchema.safeParse(data);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'manifest'}: ${issue.message}`)
      .join('; ');

    throw new Error(
      `Plugin manifest is invalid (${resourceKey(resource.resource)}@${resource.version}): ${issues}`,
    );
  }

  if (result.data.name !== resource.resource.name) {
    throw new Error(
      `Plugin manifest name does not match resource name: ${result.data.name} !== ${resource.resource.name}`,
    );
  }

  return { file: entryFile, manifest: result.data };
}

export async function readTemplateResources(
  indexPath: string,
  template: ResourceVersion,
): Promise<ResourceVersion[]> {
  const manifest = readTemplateManifest(template);

  return Promise.all(
    manifest.resources.map((resource) =>
      readResourceVersion(indexPath, resource.id, resource.version),
    ),
  );
}

export async function validateRegistry(indexPath: string): Promise<RegistryValidationResult> {
  const index = await readRegistryIndex(indexPath);
  return validateResourceIndex(index, (resource) =>
    readResourceVersion(indexPath, resourceKey(resource), resource.latestVersion),
  );
}

async function validateResourceIndex(
  index: RegistryIndex,
  readVersion: (resource: ResourceSummary) => Promise<ResourceVersion>,
): Promise<RegistryValidationResult> {
  const issues: string[] = [];
  const resourceIds = new Set<string>();

  for (const resource of index.resources) {
    const id = resourceKey(resource);
    const requestedVersion = resource.latestVersion;

    if (resourceIds.has(id)) {
      issues.push(`Duplicate resource ID: ${id}`);
      continue;
    }

    resourceIds.add(id);

    try {
      const loadedVersion = await readVersion(resource);
      const files = loadedVersion.files;
      const entryFile = files.find((file) =>
        resourceEntryFiles(resource.type).includes(file.path),
      );

      if (!entryFile) {
        issues.push(
          `${id}@${requestedVersion} is missing ${resourceEntryFiles(resource.type).join(' or ')}`,
        );
      } else if (!entryFile.content.trim()) {
        issues.push(`${id}@${requestedVersion} has an empty ${entryFile.path}`);
      }

      if (resource.type === 'tools') {
        readToolManifest(loadedVersion);
      }
    } catch (error) {
      if (isMissingPathError(error)) {
        issues.push(`Resource version not found: ${id}@${requestedVersion}`);
      } else {
        issues.push(`Could not read resource version: ${id}@${requestedVersion}`);
      }
    }
  }

  return { resourceCount: index.resources.length, issues };
}

function resourceDirectory(
  registryRoot: string,
  resource: Pick<ResourceSummary, 'owner' | 'type' | 'name'>,
  version: string,
): string {
  return join(registryRoot, resourcePackagePath(resource, version));
}

function resourcePackagePath(
  resource: Pick<ResourceSummary, 'owner' | 'type' | 'name'>,
  version: string,
): string {
  return join('resources', resource.owner, resource.type, resource.name, version);
}

function parseResourceId(resourceId: string): Pick<ResourceSummary, 'owner' | 'type' | 'name'> {
  const parts = resourceId.split('/');

  // SAFETY: Callers validate resourceId against resourceIdSchema first, which
  // requires exactly owner/type/name as non-empty slug segments.
  return {
    owner: parts[0] as string,
    type: parts[1] as ResourceType,
    name: parts[2] as string,
  };
}

async function resolveDirectory(path: string, label: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    throw new Error(`${label} not found: ${path}`, { cause: error });
  }
}

async function writeResourceFiles(directory: string, files: ResourceFile[]): Promise<void> {
  for (const file of files) {
    const destination = join(directory, file.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, file.content, 'utf8');
  }
}

async function writeRegistryIndex(indexPath: string, index: RegistryIndex): Promise<void> {
  await writeFileAtomic(indexPath, `${JSON.stringify(index, null, 2)}\n`);
}

function defaultPullRequestBody(resource: ResourceSummary): string {
  return [
    `Resource: ${resourceKey(resource)}`,
    `Version: ${resource.latestVersion}`,
    '',
    resource.description,
    '',
    'This submission is unreviewed until the pull request is reviewed and merged.',
  ].join('\n');
}

async function executeCommand(
  runner: CommandRunner,
  command: string,
  args: string[],
  cwd: string,
): Promise<CommandResult> {
  try {
    return await runner(command, args, cwd);
  } catch (error) {
    throw new Error(
      `Command failed: ${command} ${args.join(' ')}: ${error instanceof Error ? error.message : error}`,
      { cause: error },
    );
  }
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<CommandResult> {
  const result = await execFileAsync(command, args, { cwd, encoding: 'utf8' });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
