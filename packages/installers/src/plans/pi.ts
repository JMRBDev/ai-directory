import { join } from 'node:path';
import { writeFileAtomic } from '@ai-directory/config';
import { resourceKey } from '@ai-directory/contracts';
import { readToolManifest, type ResourceFile, type ResourceVersion } from '@ai-directory/registry';
import { hashContent } from '../hashing.js';
import type { InstallOptions, InstallResult, SharedOwnership } from '../install-types.js';
import {
  assertInstallPlansAvailable,
  hashInstallPlans,
  projectFiles,
  safeDestination,
  selectHashes,
  writeInstallPlans,
  type InstallFile,
  type InstallPlan,
  type PreparedText,
} from '../install-plans.js';
import { currentFile } from '../file-snapshots.js';
import { resolveHarnessPaths } from '../harnesses.js';

function piInstallRoot(options: InstallOptions): string {
  return resolveHarnessPaths('pi', options).config;
}

function piResourceDestination(root: string, resource: ResourceVersion): string {
  if (resource.resource.type === 'skills') {
    return join(root, 'skills', resource.resource.name);
  }

  if (resource.resource.type === 'plugins') {
    return join(root, 'extensions', `${resource.resource.name}.ts`);
  }

  return join(root, 'skills', resource.resource.name);
}

function piDestinationForFile(
  root: string,
  resource: ResourceVersion,
  resourcePath: string,
): string {
  const type = resource.resource.type;

  if (type === 'skills') {
    return safeDestination(piResourceDestination(root, resource), resourcePath);
  }

  if (type === 'plugins') {
    return safeDestination(join(root, 'extensions', `${resource.resource.name}.files`), resourcePath);
  }

  return safeDestination(piResourceDestination(root, resource), resourcePath);
}

function piPluginModule(resource: ResourceVersion): ResourceFile | undefined {
  return resource.files.find((file) => file.path === '.pi/plugin.ts')
    ?? resource.files.find((file) => file.path === '.pi/plugin.js')
    ?? resource.files.find((file) => file.path === '.pi/extension.ts')
    ?? resource.files.find((file) => file.path === '.pi/extension.js');
}

function createPiPlan(root: string, resource: ResourceVersion): InstallPlan {
  const type = resource.resource.type;

  if (type === 'templates') {
    throw new Error(
      'Pi installation supports skills, rules, plugins, and tools. Templates must be expanded first.',
    );
  }

  if (type === 'agents' || type === 'mcp-servers') {
    throw new Error(
      `Pi does not support ${type === 'agents' ? 'agents (no sub-agents)' : 'MCP servers'}: ${resourceKey(resource.resource)}.`,
    );
  }

  if (type === 'plugins') {
    return createPiPluginPlan(root, resource);
  }

  if (type === 'tools') {
    return createPiToolPlan(root, resource);
  }

  if (type === 'rules') {
    const entry = resource.files.find((file) => file.path === 'RULE.md');
    if (!entry) throw new Error(`Rule is missing RULE.md: ${resourceKey(resource.resource)}`);
    return {
      resource,
      destination: join(root, 'AGENTS.md'),
      files: [],
      skippedFiles: [],
    };
  }

  const projection = projectFiles(resource, 'pi');
  const files = projection.files.map((file) => ({
    ...file,
    destination: piDestinationForFile(root, resource, file.path),
  }));

  return {
    resource,
    destination: piResourceDestination(root, resource),
    files,
    skippedFiles: projection.skippedFiles,
  };
}

function createPiPluginPlan(root: string, resource: ResourceVersion): InstallPlan {
  const moduleFile = piPluginModule(resource);

  if (!moduleFile) {
    throw new Error(
      `Plugin is missing a Pi extension (.pi/plugin.ts, .pi/plugin.js, .pi/extension.ts, or .pi/extension.js): ${resourceKey(resource.resource)}`,
    );
  }

  const extension = moduleFile.path.endsWith('.ts') ? '.ts' : '.js';
  const destination = safeDestination(
    join(root, 'extensions'),
    `${resource.resource.name}${extension}`,
  );
  const supportRoot = join(root, 'extensions', `${resource.resource.name}.files`);
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

function createPiToolPlan(root: string, resource: ResourceVersion): InstallPlan {
  const executables = new Set(readToolManifest(resource).executables);
  const moduleFile = piPluginModule(resource);
  const skillEntry = resource.files.find((file) => file.path === 'SKILL.md');

  if (!moduleFile && !skillEntry) {
    throw new Error(
      `Tool is missing a Pi adapter (.pi/plugin.ts, .pi/plugin.js, .pi/extension.ts, .pi/extension.js, or SKILL.md): ${resourceKey(resource.resource)}`,
    );
  }

  const files: InstallFile[] = [];
  let destination: string | undefined;

  if (moduleFile) {
    const extension = moduleFile.path.endsWith('.ts') ? '.ts' : '.js';
    destination = safeDestination(
      join(root, 'extensions'),
      `${resource.resource.name}${extension}`,
    );
    const file: InstallFile = { ...moduleFile, destination };
    if (executables.has(moduleFile.path)) file.mode = 0o755;
    files.push(file);
  }

  if (skillEntry) {
    const skillDestination = join(root, 'skills', resource.resource.name);
    destination ??= skillDestination;
    for (const file of resource.files) {
      if (file.path === moduleFile?.path) continue;
      const target: InstallFile = {
        ...file,
        destination: safeDestination(skillDestination, file.path),
      };
      if (executables.has(file.path)) target.mode = 0o755;
      files.push(target);
    }
  }

  const installed = new Set(files.map((file) => file.path));
  const supportRoot = join(root, 'extensions', `${resource.resource.name}.files`);

  for (const file of resource.files) {
    if (installed.has(file.path)) continue;
    files.push({
      ...file,
      destination: safeDestination(supportRoot, file.path),
    });
  }

  if (!destination) {
    throw new Error(`Tool has no installable Pi files: ${resourceKey(resource.resource)}`);
  }

  return {
    resource,
    destination,
    files,
    skippedFiles: [],
  };
}

async function preparePiGuidance(
  root: string,
  plans: InstallPlan[],
  force: boolean,
): Promise<PreparedText> {
  const path = join(root, 'AGENTS.md');
  const current = await currentFile(path);
  let content = current ?? '';
  const ownership: SharedOwnership[] = [];

  for (const plan of plans) {
    const entry = plan.resource.files.find((file) => file.path === 'RULE.md');
    if (!entry) continue;

    const block = piRuleBlock(plan.resource);
    content = upsertPiRule(content, plan.resource, force);
    ownership.push({
      path,
      key: resourceKey(plan.resource.resource),
      hash: hashContent(block),
      created: current === null,
    });
  }

  return { path, content, ownership };
}

function piRuleBlock(resource: ResourceVersion): string {
  const entry = resource.files.find((file) => file.path === 'RULE.md');
  if (!entry) {
    throw new Error(`Rule is missing RULE.md: ${resourceKey(resource.resource)}`);
  }

  const key = resourceKey(resource.resource);
  return [
    `<!-- ai-directory:rule:${key} -->`,
    entry.content.endsWith('\n') ? entry.content : `${entry.content}\n`,
    `<!-- /ai-directory:rule:${key} -->`,
  ].join('\n');
}

function upsertPiRule(contents: string, resource: ResourceVersion, force: boolean): string {
  const key = resourceKey(resource.resource);
  const startMarker = `<!-- ai-directory:rule:${key} -->`;
  const endMarker = `<!-- /ai-directory:rule:${key} -->`;
  const start = contents.indexOf(startMarker);
  const end = contents.indexOf(endMarker);

  if ((start === -1) !== (end === -1) || (start !== -1 && end < start)) {
    throw new Error(`Pi managed rule block is malformed: ${key}`);
  }

  const block = piRuleBlock(resource);

  if (start !== -1 && end !== -1) {
    if (!force) {
      throw new Error(`Pi rule is already installed: ${key}. Use --force to overwrite.`);
    }

    return `${contents.slice(0, start)}${block}${contents.slice(end + endMarker.length)}`;
  }

  const separator = contents.length === 0
    ? ''
    : contents.endsWith('\n')
      ? '\n'
      : '\n\n';

  return `${contents}${separator}${block}\n`;
}

export async function installPiResources(
  resources: ResourceVersion[],
  options: InstallOptions,
): Promise<InstallResult[]> {
  if (resources.length === 0) {
    throw new Error('No resources to install.');
  }

  const root = piInstallRoot(options);
  const plans = resources.map((resource) => createPiPlan(root, resource));
  const rules = plans.filter((plan) => plan.resource.resource.type === 'rules');
  const guidance = rules.length > 0
    ? await preparePiGuidance(root, rules, options.force ?? false)
    : undefined;

  await assertInstallPlansAvailable(plans, options);
  await writeInstallPlans(plans, options.dryRun ?? false);

  if (guidance && !options.dryRun) {
    await writeFileAtomic(guidance.path, guidance.content);
  }

  const fileHashes = await hashInstallPlans(plans);

  return plans.map((plan) => {
    const isRule = plan.resource.resource.type === 'rules';
    const result: InstallResult = {
      destination: isRule && guidance ? guidance.path : plan.destination,
      files: plan.files.map((file) => file.path),
      skippedFiles: plan.skippedFiles,
      paths: [
        ...plan.files.map((file) => file.destination),
        ...(isRule && guidance ? [guidance.path] : []),
      ],
      ownedPaths: plan.files.map((file) => file.destination),
      fileHashes: selectHashes(plan.files.map((file) => file.destination), fileHashes),
      shared: guidance?.ownership?.filter((ownership) =>
        ownership.key === resourceKey(plan.resource.resource),
      ),
    };
    if (options.dryRun) {
      result.changes = [
        ...plan.files.map((file) => ({ path: file.destination, content: file.content })),
        ...(isRule && guidance ? [{ path: guidance.path, content: guidance.content }] : []),
      ];
    }
    return result;
  });
}
