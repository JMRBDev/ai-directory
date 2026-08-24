import { join } from 'node:path';
import type { ResourceVersion } from '@ai-directory/registry';
import { resolveHarnessPaths } from '../harnesses.js';
import type { InstallOptions, InstallResult } from '../install-types.js';
import {
  assertInstallPlansAvailable,
  createPluginPlan,
  destinationForFile,
  hashInstallPlans,
  isPluginBundle,
  projectFiles,
  resourceDestination,
  selectHashes,
  toolExecutablePaths,
  writeInstallPlans,
  type InstallPlan,
} from '../install-plans.js';

function claudeCodeInstallRoot(options: InstallOptions): string {
  return resolveHarnessPaths('claude-code', options).config;
}

function createClaudeCodePlan(
  root: string,
  resource: ResourceVersion,
): InstallPlan {
  if (resource.resource.type === 'templates') {
    throw new Error(
      'Claude Code installation supports skills, agents, rules, plugins, and tools. Templates must be expanded first.',
    );
  }

  if (isPluginBundle(resource)) {
    return createPluginPlan(join(root, 'skills'), resource, toolExecutablePaths(resource));
  }

  const projection = projectFiles(resource, 'claude-code');
  const files = projection.files.map((file) => ({
    ...file,
    destination: destinationForFile(root, resource, file.path),
  }));

  return {
    resource,
    destination: resourceDestination(root, resource),
    files,
    skippedFiles: projection.skippedFiles,
  };
}

export async function installClaudeCodeResources(
  resources: ResourceVersion[],
  options: InstallOptions,
): Promise<InstallResult[]> {
  if (resources.length === 0) {
    throw new Error('No resources to install.');
  }

  const root = claudeCodeInstallRoot(options);
  const plans = resources.map((resource) => createClaudeCodePlan(root, resource));

  await assertInstallPlansAvailable(plans, options);
  await writeInstallPlans(plans, options.dryRun ?? false);

  const fileHashes = await hashInstallPlans(plans);

  return plans.map((plan) => {
    const result: InstallResult = {
      destination: plan.destination,
      files: plan.files.map((file) => file.path),
      skippedFiles: plan.skippedFiles,
      paths: plan.files.map((file) => file.destination),
      ownedPaths: plan.files.map((file) => file.destination),
      fileHashes: selectHashes(plan.files.map((file) => file.destination), fileHashes),
    };
    if (options.dryRun) {
      result.changes = plan.files.map((file) => ({ path: file.destination, content: file.content }));
    }
    return result;
  });
}
