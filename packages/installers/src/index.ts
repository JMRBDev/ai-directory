import { access, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { resourceKey } from '@ai-directory/domain';
import type { ResourceVersion } from '@ai-directory/registry';

export type InstallScope = 'project' | 'global';

export type ClaudeCodeInstallOptions = {
  scope: InstallScope;
  cwd?: string;
  homeDirectory?: string;
  force?: boolean;
};

export type InstallResult = {
  destination: string;
  files: string[];
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
  }));
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
