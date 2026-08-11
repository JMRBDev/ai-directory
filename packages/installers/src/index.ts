import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { resourceKey } from '@ai-directory/domain';
import type { ResourceVersion } from '@ai-directory/registry';

export type InstallScope = 'project' | 'global';

export type Harness = 'claude-code' | 'opencode' | 'codex';

export type InstallOptions = {
  scope: InstallScope;
  cwd?: string;
  homeDirectory?: string;
  force?: boolean;
};

export type ClaudeCodeInstallOptions = InstallOptions;

export type InstallResult = {
  destination: string;
  files: string[];
  paths: string[];
};

export type InstallationRecord = {
  resource: string;
  version: string;
  harness: Harness;
  scope: InstallScope;
  destination: string;
  files: string[];
  installedAt: string;
};

export type InstallationManifest = {
  schemaVersion: 1;
  installations: InstallationRecord[];
};

export type HarnessInstaller = {
  harness: Harness;
  install(resources: ResourceVersion[], options: InstallOptions): Promise<InstallResult[]>;
};

export async function installClaudeCodeResource(
  resource: ResourceVersion,
  options: ClaudeCodeInstallOptions,
): Promise<InstallResult> {
  const [result] = await installClaudeCodeResources([resource], options);

  if (!result) {
    throw new Error('Resource installation did not produce a result.');
  }

  return result;
}

export async function installClaudeCodeResources(
  resources: ResourceVersion[],
  options: ClaudeCodeInstallOptions,
): Promise<InstallResult[]> {
  if (resources.length === 0) {
    throw new Error('No resources to install.');
  }

  const root =
    options.scope === 'project'
      ? options.cwd ?? process.cwd()
      : options.homeDirectory ?? homedir();
  const plans = resources.map((resource) => createPlan(root, resource));

  const destinations = new Set<string>();
  const overlaps: string[] = [];
  const existing: string[] = [];

  for (const plan of plans) {
    for (const file of plan.files) {
      const label = `${resourceKey(plan.resource.resource)} (${file.destination})`;

      if (destinations.has(file.destination)) {
        overlaps.push(label);
      }

      destinations.add(file.destination);

      if (!options.force && (await pathExists(file.destination))) {
        existing.push(label);
      }
    }
  }

  if (overlaps.length > 0) {
    throw new Error(`Install resources overlap at: ${overlaps.join(', ')}.`);
  }

  if (existing.length > 0) {
    throw new Error(
      `Install destinations are not available: ${existing.join(', ')}. Use --force to overwrite.`,
    );
  }

  for (const plan of plans) {
    for (const file of plan.files) {
      await mkdir(dirname(file.destination), { recursive: true });
      await writeFile(file.destination, file.content, 'utf8');
    }
  }

  return plans.map((plan) => ({
    destination: plan.destination,
    files: plan.resource.files.map((file) => file.path),
    paths: plan.files.map((file) => file.destination),
  }));
}

export const claudeCodeInstaller: HarnessInstaller = {
  harness: 'claude-code',
  install: installClaudeCodeResources,
};

export async function readInstallationManifest(path: string): Promise<InstallationManifest> {
  let data: unknown;

  try {
    data = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (isMissingPathError(error)) return { schemaVersion: 1, installations: [] };
    throw new Error(`Installation manifest is not valid JSON: ${path}`, { cause: error });
  }

  if (!isInstallationManifest(data)) {
    throw new Error(`Installation manifest is invalid: ${path}`);
  }

  return data;
}

export async function updateInstallationManifest(
  path: string,
  records: InstallationRecord[],
): Promise<InstallationManifest> {
  const current = await readInstallationManifest(path);
  const keys = new Set(records.map(installationKey));
  const manifest = {
    schemaVersion: 1 as const,
    installations: [
      ...current.installations.filter((record) => !keys.has(installationKey(record))),
      ...records,
    ],
  };

  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;

  try {
    await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }

  return manifest;
}

export async function removeStaleInstallationFiles(
  previous: InstallationRecord[],
  currentFiles: string[],
): Promise<void> {
  const keep = new Set(currentFiles);
  const stale = new Set(previous.flatMap((record) => record.files).filter((path) => !keep.has(path)));
  await Promise.all([...stale].map((path) => rm(path, { force: true })));
}

function installationKey(record: InstallationRecord): string {
  return `${record.scope}:${record.harness}:${record.resource}`;
}

function isInstallationManifest(value: unknown): value is InstallationManifest {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'schemaVersion' in value &&
    value.schemaVersion === 1 &&
    'installations' in value &&
    Array.isArray(value.installations) &&
    value.installations.every(isInstallationRecord)
  );
}

function isInstallationRecord(value: unknown): value is InstallationRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    'resource' in value &&
    typeof value.resource === 'string' &&
    'version' in value &&
    typeof value.version === 'string' &&
    'harness' in value &&
    isHarness(value.harness) &&
    'scope' in value &&
    isInstallScope(value.scope) &&
    'destination' in value &&
    typeof value.destination === 'string' &&
    'files' in value &&
    Array.isArray(value.files) &&
    value.files.every((file) => typeof file === 'string') &&
    'installedAt' in value &&
    typeof value.installedAt === 'string'
  );
}

function isHarness(value: unknown): value is Harness {
  return value === 'claude-code' || value === 'opencode' || value === 'codex';
}

function isInstallScope(value: unknown): value is InstallScope {
  return value === 'project' || value === 'global';
}

type InstallPlan = {
  resource: ResourceVersion;
  destination: string;
  files: Array<{
    path: string;
    content: string;
    destination: string;
  }>;
};

function createPlan(root: string, resource: ResourceVersion): InstallPlan {
  if (resource.resource.type === 'templates') {
    throw new Error(
      'Claude Code installation supports skills, agents, and rules. Templates must be expanded first.',
    );
  }

  const files = resource.files.map((file) => ({
    ...file,
    destination: destinationForFile(root, resource, file.path),
  }));

  return {
    resource,
    destination: resourceDestination(root, resource),
    files,
  };
}

function destinationForFile(
  root: string,
  resource: ResourceVersion,
  resourcePath: string,
): string {
  const type = resource.resource.type;

  if (type === 'skills') {
    return safeDestination(resourceDestination(root, resource), resourcePath);
  }

  const directory = join(root, '.claude', type);
  const entryFile = type === 'agents' ? 'AGENT.md' : 'RULE.md';

  if (resourcePath === entryFile) {
    return safeDestination(directory, `${resource.resource.name}.md`);
  }

  return safeDestination(
    join(directory, `${resource.resource.name}.files`),
    resourcePath,
  );
}

function resourceDestination(root: string, resource: ResourceVersion): string {
  if (resource.resource.type === 'skills') {
    return join(root, '.claude', 'skills', resource.resource.name);
  }

  return join(root, '.claude', resource.resource.type, `${resource.resource.name}.md`);
}

function safeDestination(root: string, resourcePath: string): string {
  const destination = resolve(root, resourcePath);
  const relativePath = relative(resolve(root), destination);

  if (!relativePath || isAbsolute(relativePath) || relativePath.startsWith('..')) {
    throw new Error(`Unsafe resource file path: ${resourcePath}`);
  }

  return destination;
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

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
