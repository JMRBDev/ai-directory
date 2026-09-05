import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathExists } from '@ai-directory/config';
import { resourceKey } from '@ai-directory/contracts';
import type { ResourceVersion } from '@ai-directory/registry';
import { prepareCodexMarketplace } from '../codex-marketplace.js';
import { hashContent } from '../hashing.js';
import { resolveHarnessPaths } from '../harnesses.js';
import { ruleBlock, upsertMarkedBlock } from '../managed-block.js';
import type { InstallOptions, InstallResult, SharedOwnership } from '../install-types.js';
import {
  createPluginPlan,
  isPluginBundle,
  projectFiles,
  runInstallPlans,
  safeDestination,
  toolExecutablePaths,
  type InstallPlan,
  type PreparedText,
} from '../install-plans.js';
import { currentFile } from '../file-snapshots.js';

type CodexInstallPaths = {
  root: string;
  codexHome: string;
  skillsRoot: string;
  guidanceRoot: string;
  marketplacePath: string;
};

export function codexInstallPaths(options: InstallOptions): CodexInstallPaths {
  const location = resolveHarnessPaths('codex', options);

  return {
    root: location.root,
    codexHome: location.config,
    skillsRoot: location.skills,
    guidanceRoot: location.guidance,
    marketplacePath: join(
      resolve(options.homeDirectory ?? homedir()),
      '.agents',
      'plugins',
      'marketplace.json',
    ),
  };
}

function createCodexPlan(
  paths: CodexInstallPaths,
  resource: ResourceVersion,
): InstallPlan {
  if (resource.resource.type === 'templates') {
    throw new Error(
      'Codex installation supports skills, agents, rules, plugins, and tools. Templates must be expanded first.',
    );
  }

  if (isPluginBundle(resource)) {
    return createPluginPlan(join(paths.codexHome, 'plugins'), resource, toolExecutablePaths(resource));
  }

  const projection = projectFiles(resource, 'codex');
  const files = projection.files.map((file) => ({
    ...file,
    content:
      resource.resource.type === 'agents' && file.path === 'AGENT.md'
        ? codexAgentContent(resource)
        : file.content,
    destination: codexDestinationForFile(paths, resource, file.path),
  }));

  return {
    resource,
    destination: codexResourceDestination(paths, resource),
    files,
    skippedFiles: projection.skippedFiles,
  };
}

function codexDestinationForFile(
  paths: CodexInstallPaths,
  resource: ResourceVersion,
  resourcePath: string,
): string {
  if (resource.resource.type === 'skills') {
    return safeDestination(codexResourceDestination(paths, resource), resourcePath);
  }

  if (resource.resource.type === 'agents' && resourcePath === 'AGENT.md') {
    return safeDestination(join(paths.codexHome, 'agents'), `${resource.resource.name}.toml`);
  }

  if (resource.resource.type === 'rules' && resourcePath === 'RULE.md') {
    return safeDestination(join(paths.root, '.ai-directory', 'rules'), `${resource.resource.name}.md`);
  }

  const directory = resource.resource.type === 'agents'
    ? join(paths.codexHome, 'agents')
    : join(paths.root, '.ai-directory', 'rules');

  return safeDestination(
    join(directory, `${resource.resource.name}.files`),
    resourcePath,
  );
}

function codexResourceDestination(paths: CodexInstallPaths, resource: ResourceVersion): string {
  if (resource.resource.type === 'skills') {
    return join(paths.skillsRoot, resource.resource.name);
  }

  if (resource.resource.type === 'agents') {
    return join(paths.codexHome, 'agents', `${resource.resource.name}.toml`);
  }

  return join(paths.root, '.ai-directory', 'rules', `${resource.resource.name}.md`);
}

function codexAgentContent(resource: ResourceVersion): string {
  const entry = resource.files.find((file) => file.path === 'AGENT.md');

  if (!entry) {
    throw new Error(`Agent is missing AGENT.md: ${resourceKey(resource.resource)}`);
  }

  return [
    `name = ${JSON.stringify(resource.resource.name)}`,
    `description = ${JSON.stringify(resource.resource.description)}`,
    `developer_instructions = ${JSON.stringify(entry.content)}`,
    '',
  ].join('\n');
}

async function prepareCodexGuidance(
  codexHome: string,
  plans: InstallPlan[],
  force: boolean,
): Promise<PreparedText> {
  const path = await codexGuidancePath(codexHome);
  const current = await currentFile(path);
  let content = current ?? '';
  const ownership: SharedOwnership[] = [];

  for (const plan of plans) {
    const block = codexRuleBlock(plan.resource);
    content = upsertCodexRule(content, plan.resource, force);
    ownership.push({
      path,
      key: resourceKey(plan.resource.resource),
      hash: hashContent(block),
      created: current === null,
    });
  }

  return { path, content, ownership };
}

async function codexGuidancePath(codexHome: string): Promise<string> {
  const overridePath = join(codexHome, 'AGENTS.override.md');

  if (await pathExists(overridePath)) {
    return overridePath;
  }

  return join(codexHome, 'AGENTS.md');
}

function upsertCodexRule(
  contents: string,
  resource: ResourceVersion,
  force: boolean,
): string {
  const key = resourceKey(resource.resource);
  return upsertMarkedBlock(
    contents,
    key,
    codexRuleBlock(resource),
    force,
    'Codex rule is already installed',
    'Codex managed rule block is malformed',
  );
}

function codexRuleBlock(resource: ResourceVersion): string {
  const entry = resource.files.find((file) => file.path === 'RULE.md');

  if (!entry) {
    throw new Error(`Rule is missing RULE.md: ${resourceKey(resource.resource)}`);
  }

  return ruleBlock(resourceKey(resource.resource), entry.content);
}

export async function installCodexResources(
  resources: ResourceVersion[],
  options: InstallOptions,
): Promise<InstallResult[]> {
  if (resources.length === 0) {
    throw new Error('No resources to install.');
  }

  const paths = codexInstallPaths(options);
  const plans = resources.map((resource) => createCodexPlan(paths, resource));
  const rules = plans.filter((plan) => plan.resource.resource.type === 'rules');
  const plugins = plans.filter((plan) => isPluginBundle(plan.resource));
  const guidance = rules.length > 0
    ? await prepareCodexGuidance(paths.guidanceRoot, rules, options.force ?? false)
    : undefined;
  const marketplace = plugins.length > 0
    ? await prepareCodexMarketplace(paths.marketplacePath, plugins, options.force ?? false)
    : undefined;

  const extras = [guidance, marketplace].filter((extra) => extra !== undefined);
  const sharedOwnership = (plan: InstallPlan) => [
    ...(guidance?.ownership?.filter((ownership) =>
      ownership.key === resourceKey(plan.resource.resource),
    ) ?? []),
    ...(marketplace?.ownership?.filter((ownership) =>
      ownership.key === resourceKey(plan.resource.resource),
    ) ?? []),
  ];
  const isRulePlan = (plan: InstallPlan) => plan.resource.resource.type === 'rules' && guidance !== undefined;
  const isMarketplacePlan = (plan: InstallPlan) => isPluginBundle(plan.resource) && marketplace !== undefined;
  return runInstallPlans(
    plans,
    options,
    extras,
    sharedOwnership,
    (plan) => isRulePlan(plan) && guidance ? guidance.path : plan.destination,
    (plan) => [
      ...(isRulePlan(plan) && guidance ? [{ path: guidance.path, content: guidance.content }] : []),
      ...(isMarketplacePlan(plan) && marketplace ? [{ path: marketplace.path, content: marketplace.content }] : []),
    ],
  );
}
