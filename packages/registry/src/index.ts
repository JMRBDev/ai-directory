import { execFile } from 'node:child_process';
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import {
  registryIndexSchema,
  resourceIdSchema,
  resourceVersionSchema,
  templateManifestSchema,
  type ResourceType,
  type ResourceSummary,
  type RegistryIndex,
  type TemplateManifest,
} from '@ai-directory/contracts';
import { resourceKey } from '@ai-directory/domain';
import { gt as isGreaterVersion, valid as isValidVersion } from 'semver';
import { parse as parseYaml } from 'yaml';

export type ResourceFile = {
  path: string;
  content: string;
};

export type ResourceVersion = {
  resource: ResourceSummary;
  version: string;
  files: ResourceFile[];
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
  description: string;
};

export type PublishResourceResult = {
  resource: ResourceSummary;
  packageDirectory: string;
  files: string[];
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

export type SubmitResourceOptions = PublishResourceOptions & {
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

const requiredEntryFiles: Record<ResourceType, string> = {
  skills: 'SKILL.md',
  agents: 'AGENT.md',
  rules: 'RULE.md',
  templates: 'TEMPLATE.md',
};

function parseRegistryIndex(data: unknown, source: string): RegistryIndex {
  const result = registryIndexSchema.safeParse(data);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'index'}: ${issue.message}`)
      .join('; ');

    throw new Error(`Registry index is invalid (${source}): ${issues}`);
  }

  return result.data;
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

  return parseRegistryIndex(data, filePath);
}

export async function fetchRegistryIndex(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<RegistryIndex> {
  let response: Response;

  try {
    response = await fetcher(url);
  } catch (error) {
    throw new Error(`Could not fetch registry index: ${url}`, { cause: error });
  }

  if (!response.ok) {
    throw new Error(
      `Registry index request failed (${response.status} ${response.statusText}): ${url}`,
    );
  }

  let data: unknown;

  try {
    data = await response.json();
  } catch (error) {
    throw new Error(`Registry index response is not valid JSON: ${url}`, { cause: error });
  }

  return parseRegistryIndex(data, url);
}

async function readResourceFiles(directory: string, prefix = ''): Promise<ResourceFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
      .map(async (entry) => {
        const filePath = join(directory, entry.name);
        const resourcePath = prefix ? join(prefix, entry.name) : entry.name;

        if (entry.isDirectory()) {
          return readResourceFiles(filePath, resourcePath);
        }

        return [{ path: resourcePath, content: await readFile(filePath, 'utf8') }];
      }),
  );

  return files.flat();
}

export async function readResourceVersion(
  indexPath: string,
  resourceId: string,
  requestedVersion?: string,
): Promise<ResourceVersion> {
  const index = await readRegistryIndex(indexPath);
  const resource = index.resources.find((candidate) => resourceKey(candidate) === resourceId);

  if (!resource) {
    throw new Error(`Resource not found: ${resourceId}`);
  }

  const version = requestedVersion ?? resource.latestVersion;

  if (!resourceVersionSchema.safeParse(version).success) {
    throw new Error(`Invalid resource version: ${version}`);
  }

  const directory = resourceDirectory(dirname(await realpath(indexPath)), resource, version);

  let files: ResourceFile[];

  try {
    files = await readResourceFiles(directory);
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

export async function publishResource(
  options: PublishResourceOptions,
): Promise<PublishResourceResult> {
  const resourceId = resourceIdSchema.safeParse(options.resourceId);

  if (!resourceId.success) {
    throw new Error(`Invalid resource ID: ${options.resourceId}`);
  }

  if (
    !resourceVersionSchema.safeParse(options.version).success ||
    !isValidVersion(options.version)
  ) {
    throw new Error(`Invalid resource version: ${options.version}`);
  }

  if (!options.description.trim()) {
    throw new Error('Resource description cannot be empty.');
  }

  const identity = parseResourceId(options.resourceId);
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

  const sourceDirectory = await resolveDirectory(options.sourceDirectory, 'Resource source directory');
  const files = await readResourceFiles(sourceDirectory);
  const entryFile = files.find((file) => file.path === requiredEntryFiles[identity.type]);

  if (!entryFile) {
    throw new Error(
      `${options.resourceId}@${options.version} is missing ${requiredEntryFiles[identity.type]}`,
    );
  }

  if (!entryFile.content.trim()) {
    throw new Error(`${options.resourceId}@${options.version} has an empty ${entryFile.path}`);
  }

  const registryIndexPath = await resolveFile(options.indexPath, 'Registry index');
  const packageDirectory = resourceDirectory(
    dirname(registryIndexPath),
    identity,
    options.version,
  );

  if (await pathExists(packageDirectory)) {
    throw new Error(`Resource version already exists: ${options.resourceId}@${options.version}`);
  }

  await writeResourceFiles(packageDirectory, files);

  const resource: ResourceSummary = current
    ? {
        ...current,
        description: options.description,
        latestVersion: options.version,
        reviewStatus: 'unreviewed',
        updatedAt: new Date().toISOString(),
      }
    : {
        ...identity,
        description: options.description,
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
    files: files.map((file) => file.path),
  };
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

  return submitResourceInCheckout(options);
}

async function submitResourceInCheckout(
  options: SubmitResourceOptions,
): Promise<SubmitResourceResult> {
  if (!resourceIdSchema.safeParse(options.resourceId).success) {
    throw new Error(`Invalid resource ID: ${options.resourceId}`);
  }

  const registryIndexPath = await resolveFile(options.indexPath, 'Registry index');
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

    await executeCommand(runner, 'git', ['add', '--', indexFile, packageDirectory], registryRoot);
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
  await executeCommand(runner, 'git', ['sparse-checkout', 'set', 'index.json'], destination);
  await executeCommand(runner, 'git', ['checkout', baseBranch], destination);
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
  const registryRoot = dirname(await realpath(indexPath));
  const issues: string[] = [];
  const resourceIds = new Set<string>();

  for (const resource of index.resources) {
    const id = resourceKey(resource);
    const version = resource.latestVersion;

    if (resourceIds.has(id)) {
      issues.push(`Duplicate resource ID: ${id}`);
      continue;
    }

    resourceIds.add(id);

    try {
      const files = await readResourceFiles(resourceDirectory(registryRoot, resource, version));
      const entryFile = files.find((file) => file.path === requiredEntryFiles[resource.type]);

      if (!entryFile) {
        issues.push(`${id}@${version} is missing ${requiredEntryFiles[resource.type]}`);
      } else if (!entryFile.content.trim()) {
        issues.push(`${id}@${version} has an empty ${entryFile.path}`);
      }
    } catch (error) {
      if (isMissingPathError(error)) {
        issues.push(`Resource version not found: ${id}@${version}`);
      } else {
        issues.push(`Could not read resource version: ${id}@${version}`);
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
  return join(
    registryRoot,
    'resources',
    resource.owner,
    resource.type,
    resource.name,
    version,
  );
}

function parseResourceId(resourceId: string): Pick<ResourceSummary, 'owner' | 'type' | 'name'> {
  const parts = resourceId.split('/');

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

async function resolveFile(path: string, label: string): Promise<string> {
  return resolveDirectory(path, label);
}

async function writeResourceFiles(directory: string, files: ResourceFile[]): Promise<void> {
  for (const file of files) {
    const destination = join(directory, file.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, file.content, 'utf8');
  }
}

async function writeRegistryIndex(indexPath: string, index: RegistryIndex): Promise<void> {
  const temporaryPath = `${indexPath}.tmp-${process.pid}-${Date.now()}`;

  try {
    await writeFile(`${temporaryPath}`, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, indexPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }

    throw error;
  }
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

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
