import { join } from 'node:path';
import type { ResourceVersion } from '@ai-directory/registry';
import { resolveHarnessPaths } from '../harnesses.js';
import type { InstallOptions, InstallResult } from '../install-types.js';
import {
  createPluginPlan,
  destinationForFile,
  isPluginBundle,
  projectFiles,
  resourceDestination,
  runInstallPlans,
  toolExecutablePaths,
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

  return runInstallPlans(plans, options);
}
