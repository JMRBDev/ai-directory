import { chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathExists, writeFileAtomic } from '@ai-directory/config';
import { resourceKey } from '@ai-directory/contracts';
import { readToolManifest, type ResourceFile, type ResourceVersion } from '@ai-directory/registry';
import { hashContent } from './hashing.js';
import type { Harness } from './harnesses.js';
import type { InstallOptions, InstallResult, SharedOwnership } from './install-types.js';
import { isPathWithin, pathsOverlap } from './paths.js';

export type InstallPlan = {
  resource: ResourceVersion;
  destination: string;
  files: InstallFile[];
  skippedFiles: string[];
};

export type InstallFile = {
  path: string;
  content: string;
  mode?: number;
  destination: string;
};

export type PreparedText = {
  path: string;
  content: string;
  ownership?: SharedOwnership[];
};

export function isPluginBundleType(
  type: ResourceVersion['resource']['type'] | undefined,
): type is 'plugins' | 'tools' {
  return type === 'plugins' || type === 'tools';
}

export function isPluginBundle(resource: ResourceVersion): boolean {
  return isPluginBundleType(resource.resource.type);
}

export function openCodePluginModule(resource: ResourceVersion): ResourceFile | undefined {
  return resource.files.find((file) => file.path === '.opencode/plugin.ts')
    ?? resource.files.find((file) => file.path === '.opencode/plugin.js');
}

export function projectFiles(resource: ResourceVersion, harness: Harness) {
  const files = resource.files.filter((file) =>
    harness === 'codex' || file.path.replaceAll('\\', '/') !== 'agents/openai.yaml',
  );

  return {
    files,
    skippedFiles: resource.files
      .filter((file) => !files.includes(file))
      .map((file) => file.path),
  };
}

export function destinationForFile(
  root: string,
  resource: ResourceVersion,
  resourcePath: string,
): string {
  const type = resource.resource.type;

  if (type === 'skills') {
    return safeDestination(resourceDestination(root, resource), resourcePath);
  }

  const directory = join(root, type);
  const entryFile = type === 'agents' ? 'AGENT.md' : 'RULE.md';

  if (resourcePath === entryFile) {
    return safeDestination(directory, `${resource.resource.name}.md`);
  }

  return safeDestination(
    join(directory, `${resource.resource.name}.files`),
    resourcePath,
  );
}

export function resourceDestination(root: string, resource: ResourceVersion): string {
  if (resource.resource.type === 'skills') {
    return join(root, 'skills', resource.resource.name);
  }

  return join(root, resource.resource.type, `${resource.resource.name}.md`);
}

export function createPluginPlan(
  root: string,
  resource: ResourceVersion,
  executablePaths: readonly string[] = [],
): InstallPlan {
  const destination = join(root, resource.resource.name);
  const executables = new Set(executablePaths);
  const files = resource.files.map((file) => withExecutableMode({
    ...file,
    destination: safeDestination(destination, file.path),
  }, executables.has(file.path)));

  return { resource, destination, files, skippedFiles: [] };
}

export function toolExecutablePaths(resource: ResourceVersion): readonly string[] {
  return resource.resource.type === 'tools' ? readToolManifest(resource).executables : [];
}

export function withExecutableMode(file: InstallFile, executable: boolean): InstallFile {
  if (executable) file.mode = 0o755;
  return file;
}

export function safeDestination(root: string, resourcePath: string): string {
  const destination = resolve(root, resourcePath);

  if (!isPathWithin(destination, resolve(root))) {
    throw new Error(`Unsafe resource file path: ${resourcePath}`);
  }

  return destination;
}

export async function assertInstallPlansAvailable(
  plans: InstallPlan[],
  options: InstallOptions,
): Promise<void> {
  const destinations: Array<{ path: string; label: string }> = [];
  const files = new Set<string>();
  const overlaps: string[] = [];
  const existing: string[] = [];

  for (const plan of plans) {
    const destinationLabel = `${resourceKey(plan.resource.resource)} (${plan.destination})`;
    const previousDestination = destinations.find((item) => pathsOverlap(item.path, plan.destination));
    if (previousDestination) {
      overlaps.push(`${destinationLabel} overlaps ${previousDestination.label}`);
    }
    destinations.push({ path: plan.destination, label: destinationLabel });

    if (!options.dryRun && !options.force && (await pathExists(plan.destination))) {
      existing.push(destinationLabel);
    }

    for (const file of plan.files) {
      const label = `${resourceKey(plan.resource.resource)} (${file.destination})`;

      if (files.has(file.destination)) {
        overlaps.push(label);
      }

      files.add(file.destination);

      if (!options.dryRun && !options.force && (await pathExists(file.destination))) {
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
}

export async function writeInstallPlans(plans: InstallPlan[], dryRun: boolean): Promise<void> {
  if (dryRun) return;

  for (const plan of plans) {
    for (const file of plan.files) {
      await writeFileAtomic(file.destination, file.content);
      if (file.mode !== undefined) await chmod(file.destination, file.mode);
    }
  }
}

export async function hashInstallPlans(plans: InstallPlan[]): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};

  for (const plan of plans) {
    for (const file of plan.files) {
      hashes[file.destination] = hashContent(file.content);
    }
  }

  return hashes;
}

export function selectHashes(
  paths: string[],
  hashes: Record<string, string>,
) {
  const selected: Record<string, string> = {};

  for (const path of paths) {
    const hash = hashes[path];
    if (hash) selected[path] = hash;
  }

  return selected;
}

export type SharedConfigExtra = {
  path: string;
  content: string;
  appliesToPlan: (plan: InstallPlan) => boolean;
  ownershipForPlan: (plan: InstallPlan) => SharedOwnership[];
  destinationOverride?: (plan: InstallPlan) => string | undefined;
};

export async function runInstallPlans(
  plans: InstallPlan[],
  options: InstallOptions,
  extras: PreparedText[] = [],
  sharedForPlan: (plan: InstallPlan) => SharedOwnership[] = () => [],
  destinationForPlan: (plan: InstallPlan) => string = (plan) => plan.destination,
  extraChangesForPlan: (plan: InstallPlan) => Array<{ path: string; content: string }> = () => [],
): Promise<InstallResult[]> {
  await assertInstallPlansAvailable(plans, options);
  await writeInstallPlans(plans, options.dryRun ?? false);

  for (const extra of extras) {
    if (!options.dryRun) {
      await writeFileAtomic(extra.path, extra.content);
    }
  }

  const fileHashes = await hashInstallPlans(plans);

  return plans.map((plan) => {
    const extraChanges = extraChangesForPlan(plan);
    const extraPaths = extraChanges.map((change) => change.path);
    const result: InstallResult = {
      destination: destinationForPlan(plan),
      files: plan.files.map((file) => file.path),
      skippedFiles: plan.skippedFiles,
      paths: [...plan.files.map((file) => file.destination), ...extraPaths],
      ownedPaths: plan.files.map((file) => file.destination),
      fileHashes: selectHashes(plan.files.map((file) => file.destination), fileHashes),
      shared: sharedForPlan(plan),
    };
    if (options.dryRun) {
      result.changes = [
        ...plan.files.map((file) => ({ path: file.destination, content: file.content })),
        ...extraChanges,
      ];
    }
    return result;
  });
}
