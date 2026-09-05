import { dirname, join, relative } from 'node:path';
import { resourceKey } from '@ai-directory/contracts';
import { readToolManifest, type ResourceVersion } from '@ai-directory/registry';
import type { InstallOptions, InstallResult } from '../install-types.js';
import {
  destinationForFile,
  openCodePluginModule,
  projectFiles,
  resourceDestination,
  runInstallPlans,
  safeDestination,
  withExecutableMode,
  type InstallFile,
  type InstallPlan,
  type PreparedText,
} from '../install-plans.js';
import { toPosixPath } from '../paths.js';
import { currentFile } from '../file-snapshots.js';
import {
  addOpenCodeInstructions,
  openCodeConfigPath,
  openCodeInstallRoot,
} from '../opencode-config.js';

function createOpenCodePlan(
  root: string,
  resource: ResourceVersion,
): InstallPlan {
  if (resource.resource.type === 'templates') {
    throw new Error(
      'OpenCode installation supports skills, agents, rules, plugins, and tools. Templates must be expanded first.',
    );
  }

  if (resource.resource.type === 'plugins') {
    return createOpenCodePluginPlan(root, resource);
  }

  if (resource.resource.type === 'tools') {
    return createOpenCodeToolPlan(root, resource);
  }

  const projection = projectFiles(resource, 'opencode');
  const files = projection.files.map((file) => ({
    ...file,
    content:
      resource.resource.type === 'agents' && file.path === 'AGENT.md'
        ? openCodeAgentContent(resource)
        : file.content,
    destination: destinationForFile(root, resource, file.path),
  }));

  return {
    resource,
    destination: resourceDestination(root, resource),
    files,
    skippedFiles: projection.skippedFiles,
  };
}

function createOpenCodePluginPlan(
  root: string,
  resource: ResourceVersion,
): InstallPlan {
  const moduleFile = openCodePluginModule(resource);

  if (!moduleFile) {
    throw new Error(
      `Plugin is missing an OpenCode module (.opencode/plugin.ts or .opencode/plugin.js): ${resourceKey(resource.resource)}`,
    );
  }

  const extension = moduleFile.path.endsWith('.ts') ? '.ts' : '.js';
  const destination = safeDestination(
    join(root, 'plugins'),
    `${resource.resource.name}${extension}`,
  );
  const supportRoot = join(root, 'plugins', `${resource.resource.name}.files`);
  const files: InstallFile[] = [{ ...moduleFile, destination }];

  for (const file of resource.files) {
    if (file.path === moduleFile.path) continue;
    files.push({
      ...file,
      destination: safeDestination(supportRoot, file.path),
    });
  }

  return {
    resource,
    destination,
    files,
    skippedFiles: [],
  };
}

function createOpenCodeToolPlan(
  root: string,
  resource: ResourceVersion,
): InstallPlan {
  const executables = new Set(readToolManifest(resource).executables);
  const moduleFile = openCodePluginModule(resource);
  const customToolFiles = resource.files.filter((file) =>
    file.path.startsWith('.opencode/tools/'),
  );

  if (!moduleFile && customToolFiles.length === 0) {
    throw new Error(
      `Tool is missing an OpenCode adapter (.opencode/plugin.ts, .opencode/plugin.js, or .opencode/tools/*): ${resourceKey(resource.resource)}`,
    );
  }

  const files: InstallFile[] = [];
  let destination: string | undefined;

  if (moduleFile) {
    const extension = moduleFile.path.endsWith('.ts') ? '.ts' : '.js';
    destination = safeDestination(
      join(root, 'plugins'),
      `${resource.resource.name}${extension}`,
    );
    files.push(withExecutableMode({
      ...moduleFile,
      destination,
    }, executables.has(moduleFile.path)));
  }

  for (const file of customToolFiles) {
    const relativePath = file.path.slice('.opencode/tools/'.length);
    const fileDestination = safeDestination(
      join(root, 'tools', resource.resource.name),
      relativePath,
    );
    destination ??= fileDestination;
    files.push(withExecutableMode({
      ...file,
      destination: fileDestination,
    }, executables.has(file.path)));
  }

  const installed = new Set(files.map((file) => file.path));
  const supportRoot = moduleFile
    ? join(root, 'plugins', `${resource.resource.name}.files`)
    : join(root, 'tools', `${resource.resource.name}.files`);

  for (const file of resource.files) {
    if (installed.has(file.path)) continue;
    files.push(withExecutableMode({
      ...file,
      destination: safeDestination(supportRoot, file.path),
    }, executables.has(file.path)));
  }

  if (!destination) {
    throw new Error(`Tool has no installable OpenCode files: ${resourceKey(resource.resource)}`);
  }

  return {
    resource,
    destination,
    files,
    skippedFiles: [],
  };
}

function openCodeAgentContent(resource: ResourceVersion): string {
  const entry = resource.files.find((file) => file.path === 'AGENT.md');

  if (!entry) {
    throw new Error(`Agent is missing AGENT.md: ${resourceKey(resource.resource)}`);
  }

  return [
    '---',
    `description: ${JSON.stringify(resource.resource.description)}`,
    'mode: subagent',
    '---',
    '',
    entry.content,
  ].join('\n');
}

async function prepareOpenCodeInstructions(
  root: string,
  resources: ResourceVersion[],
  options: InstallOptions,
): Promise<PreparedText> {
  const path = await openCodeConfigPath(root, options);
  const entries = resources.map((resource) => ({
    key: resourceKey(resource.resource),
    entry: toPosixPath(relative(
      dirname(path),
      resourceDestination(root, resource),
    )),
  }));
  return addOpenCodeInstructions(path, await currentFile(path), entries);
}

export async function installOpenCodeResources(
  resources: ResourceVersion[],
  options: InstallOptions,
): Promise<InstallResult[]> {
  if (resources.length === 0) {
    throw new Error('No resources to install.');
  }

  const root = openCodeInstallRoot(options);
  const plans = resources.map((resource) => createOpenCodePlan(root, resource));
  const rules = plans.filter((plan) => plan.resource.resource.type === 'rules');
  const config = rules.length > 0
    ? await prepareOpenCodeInstructions(
        root,
        rules.map((plan) => plan.resource),
        options,
      )
    : undefined;

  const isRulePlan = (plan: InstallPlan) => plan.resource.resource.type === 'rules' && config !== undefined;
  return runInstallPlans(
    plans,
    options,
    config ? [config] : [],
    (plan) => config?.ownership?.filter((ownership) =>
      ownership.key === resourceKey(plan.resource.resource),
    ) ?? [],
    (plan) => plan.destination,
    (plan) => isRulePlan(plan) && config ? [{ path: config.path, content: config.content }] : [],
  );
}
