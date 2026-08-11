import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { resourceKey } from '@ai-directory/domain';
import type { ResourceVersion } from '@ai-directory/registry';
import { applyEdits, modify, parse } from 'jsonc-parser';

export type InstallScope = 'project' | 'global';

export type Harness = 'claude-code' | 'opencode' | 'codex';

export type InstallOptions = {
  scope: InstallScope;
  cwd?: string;
  homeDirectory?: string;
  force?: boolean;
  environment?: NodeJS.ProcessEnv;
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

export type ResourceInstallationMode = 'native' | 'translated' | 'configured';

export type ResourceKind = Exclude<ResourceVersion['resource']['type'], 'templates'>;

export type HarnessAdapter = {
  harness: Harness;
  installation: 'native-filesystem';
  capabilities: Record<ResourceKind, ResourceInstallationMode>;
  install(resources: ResourceVersion[], options: InstallOptions): Promise<InstallResult[]>;
};

export function getHarnessAdapter(value: string): HarnessAdapter {
  const adapter = harnessAdapters[value as Harness];

  if (!adapter) {
    throw new Error(`Unsupported harness: ${value}`);
  }

  return adapter;
}

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
  return installResources(resources, options, createClaudeCodePlan, claudeCodeInstallRoot);
}

export async function installOpenCodeResources(
  resources: ResourceVersion[],
  options: InstallOptions,
): Promise<InstallResult[]> {
  if (resources.length === 0) {
    throw new Error('No resources to install.');
  }

  const root = openCodeInstallRoot(options);
  const plans = resources.map((resource) => createOpenCodePlan(root, resource, options.scope));
  const rules = plans.filter((plan) => plan.resource.resource.type === 'rules');
  const config = rules.length > 0
    ? await prepareOpenCodeInstructions(
        root,
        options.scope,
        rules.map((plan) => plan.resource),
        options,
      )
    : undefined;

  await assertInstallPlansAvailable(plans, options);
  await writeInstallPlans(plans);

  if (config) {
    await writeTextAtomic(config.path, config.content);
  }

  return plans.map((plan) => ({
    destination: plan.destination,
    files: plan.resource.files.map((file) => file.path),
    paths: [
      ...plan.files.map((file) => file.destination),
      ...(plan.resource.resource.type === 'rules' && config ? [config.path] : []),
    ],
  }));
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
  const guidance = rules.length > 0
    ? await prepareCodexGuidance(paths.guidanceRoot, rules, options.force ?? false)
    : undefined;

  await assertInstallPlansAvailable(plans, options);
  await writeInstallPlans(plans);

  if (guidance) {
    await writeTextAtomic(guidance.path, guidance.content);
  }

  return plans.map((plan) => ({
    destination:
      plan.resource.resource.type === 'rules' && guidance
        ? guidance.path
        : plan.destination,
    files: plan.resource.files.map((file) => file.path),
    paths: [
      ...plan.files.map((file) => file.destination),
      ...(plan.resource.resource.type === 'rules' && guidance ? [guidance.path] : []),
    ],
  }));
}

async function installResources(
  resources: ResourceVersion[],
  options: InstallOptions,
  createPlanForResource: (
    root: string,
    resource: ResourceVersion,
    scope: InstallScope,
  ) => InstallPlan,
  getRoot: (options: InstallOptions) => string,
): Promise<InstallResult[]> {
  if (resources.length === 0) {
    throw new Error('No resources to install.');
  }

  const root = getRoot(options);
  const plans = resources.map((resource) =>
    createPlanForResource(root, resource, options.scope),
  );

  await assertInstallPlansAvailable(plans, options);
  await writeInstallPlans(plans);

  return plans.map((plan) => ({
    destination: plan.destination,
    files: plan.resource.files.map((file) => file.path),
    paths: plan.files.map((file) => file.destination),
  }));
}

async function assertInstallPlansAvailable(
  plans: InstallPlan[],
  options: InstallOptions,
): Promise<void> {
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
}

async function writeInstallPlans(plans: InstallPlan[]): Promise<void> {
  for (const plan of plans) {
    for (const file of plan.files) {
      await mkdir(dirname(file.destination), { recursive: true });
      await writeFile(file.destination, file.content, 'utf8');
    }
  }
}

export const claudeCodeInstaller: HarnessAdapter = {
  harness: 'claude-code',
  installation: 'native-filesystem',
  capabilities: { skills: 'native', agents: 'native', rules: 'native' },
  install: installClaudeCodeResources,
};

export const openCodeInstaller: HarnessAdapter = {
  harness: 'opencode',
  installation: 'native-filesystem',
  capabilities: { skills: 'native', agents: 'translated', rules: 'configured' },
  install: installOpenCodeResources,
};

export const codexInstaller: HarnessAdapter = {
  harness: 'codex',
  installation: 'native-filesystem',
  capabilities: { skills: 'native', agents: 'translated', rules: 'configured' },
  install: installCodexResources,
};

const harnessAdapters: Record<Harness, HarnessAdapter> = {
  'claude-code': claudeCodeInstaller,
  opencode: openCodeInstaller,
  codex: codexInstaller,
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

  await writeTextAtomic(path, `${JSON.stringify(manifest, null, 2)}\n`);

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
  files: InstallFile[];
};

type InstallFile = {
  path: string;
  content: string;
  destination: string;
};

type PreparedText = {
  path: string;
  content: string;
};

type CodexInstallPaths = {
  root: string;
  codexHome: string;
  guidanceRoot: string;
};

function createClaudeCodePlan(
  root: string,
  resource: ResourceVersion,
  _scope: InstallScope,
): InstallPlan {
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

function createOpenCodePlan(
  root: string,
  resource: ResourceVersion,
  scope: InstallScope,
): InstallPlan {
  if (resource.resource.type === 'templates') {
    throw new Error(
      'OpenCode installation supports skills, agents, and rules. Templates must be expanded first.',
    );
  }

  const files = resource.files.map((file) => ({
    ...file,
    content:
      resource.resource.type === 'agents' && file.path === 'AGENT.md'
        ? openCodeAgentContent(resource)
        : file.content,
    destination: openCodeDestinationForFile(
      root,
      resource,
      file.path,
      scope,
    ),
  }));

  return {
    resource,
    destination: openCodeResourceDestination(root, resource, scope),
    files,
  };
}

function createCodexPlan(
  paths: CodexInstallPaths,
  resource: ResourceVersion,
): InstallPlan {
  if (resource.resource.type === 'templates') {
    throw new Error(
      'Codex installation supports skills, agents, and rules. Templates must be expanded first.',
    );
  }

  const files = resource.files.map((file) => ({
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

function claudeCodeInstallRoot(options: InstallOptions): string {
  if (options.scope === 'project') {
    return join(options.cwd ?? process.cwd(), '.claude');
  }

  if (options.homeDirectory) {
    return join(options.homeDirectory, '.claude');
  }

  return configuredPath(options, 'CLAUDE_CONFIG_DIR') ?? join(homedir(), '.claude');
}

function openCodeInstallRoot(options: InstallOptions): string {
  if (options.scope === 'project') return options.cwd ?? process.cwd();

  return configuredPath(options, 'OPENCODE_CONFIG_DIR')
    ?? join(options.homeDirectory ?? homedir(), '.config', 'opencode');
}

function codexInstallPaths(options: InstallOptions): CodexInstallPaths {
  const home = options.homeDirectory ?? homedir();
  const project = options.cwd ?? process.cwd();

  return {
    root: options.scope === 'project' ? project : home,
    codexHome: options.scope === 'project'
      ? join(project, '.codex')
      : configuredPath(options, 'CODEX_HOME') ?? join(home, '.codex'),
    guidanceRoot: options.scope === 'project'
      ? project
      : configuredPath(options, 'CODEX_HOME') ?? join(home, '.codex'),
  };
}

function resourceDestination(root: string, resource: ResourceVersion): string {
  if (resource.resource.type === 'skills') {
    return join(root, 'skills', resource.resource.name);
  }

  return join(root, resource.resource.type, `${resource.resource.name}.md`);
}

function openCodeDestinationForFile(
  root: string,
  resource: ResourceVersion,
  resourcePath: string,
  scope: InstallScope,
): string {
  const directory = scope === 'project' ? join(root, '.opencode') : root;

  if (resource.resource.type === 'skills') {
    return safeDestination(
      openCodeResourceDestination(root, resource, scope),
      resourcePath,
    );
  }

  const type = resource.resource.type;
  const entryFile = type === 'agents' ? 'AGENT.md' : 'RULE.md';

  if (resourcePath === entryFile) {
    return safeDestination(join(directory, type), `${resource.resource.name}.md`);
  }

  return safeDestination(
    join(directory, type, `${resource.resource.name}.files`),
    resourcePath,
  );
}

function openCodeResourceDestination(
  root: string,
  resource: ResourceVersion,
  scope: InstallScope,
): string {
  const directory = scope === 'project' ? join(root, '.opencode') : root;

  if (resource.resource.type === 'skills') {
    return join(directory, 'skills', resource.resource.name);
  }

  return join(directory, resource.resource.type, `${resource.resource.name}.md`);
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
    return join(paths.root, '.agents', 'skills', resource.resource.name);
  }

  if (resource.resource.type === 'agents') {
    return join(paths.codexHome, 'agents', `${resource.resource.name}.toml`);
  }

  return join(paths.root, '.ai-directory', 'rules', `${resource.resource.name}.md`);
}

async function prepareOpenCodeInstructions(
  root: string,
  scope: InstallScope,
  resources: ResourceVersion[],
  options: InstallOptions,
): Promise<PreparedText> {
  const path = await openCodeConfigPath(root, scope, options);
  const entries = resources.map((resource) =>
    toPosixPath(relative(
      dirname(path),
      openCodeResourceDestination(root, resource, scope),
    )),
  );
  const current = await readOptionalText(path);

  if (current === null) {
    return {
      path,
      content: `${JSON.stringify({ instructions: entries }, null, 2)}\n`,
    };
  }

  const errors: Array<{ error: number; offset: number; length: number }> = [];
  const data = parse(current, errors);

  if (
    errors.length > 0 ||
    typeof data !== 'object' ||
    data === null ||
    Array.isArray(data)
  ) {
    throw new Error(`OpenCode config is not a valid object: ${path}`);
  }

  const currentInstructions = 'instructions' in data ? data.instructions : undefined;

  if (
    currentInstructions !== undefined &&
    (!Array.isArray(currentInstructions) ||
      currentInstructions.some((entry) => typeof entry !== 'string'))
  ) {
    throw new Error(`OpenCode config instructions must be an array of strings: ${path}`);
  }

  const instructions = currentInstructions === undefined
    ? []
    : [...currentInstructions];

  for (const entry of entries) {
    if (!instructions.includes(entry)) {
      instructions.push(entry);
    }
  }

  return {
    path,
    content: applyEdits(
      current,
      modify(current, ['instructions'], instructions, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      }),
    ),
  };
}

async function openCodeConfigPath(
  root: string,
  scope: InstallScope,
  options: InstallOptions,
): Promise<string> {
  const customPath = configuredPath(options, 'OPENCODE_CONFIG');

  if (customPath) {
    return customPath;
  }

  const candidates = scope === 'project'
    ? [
        join(root, 'opencode.jsonc'),
        join(root, 'opencode.json'),
        join(root, '.opencode', 'opencode.jsonc'),
        join(root, '.opencode', 'opencode.json'),
      ]
    : [join(root, 'opencode.jsonc'), join(root, 'opencode.json')];

  for (const path of candidates) {
    if (await pathExists(path)) {
      return path;
    }
  }

  return join(root, 'opencode.json');
}

async function prepareCodexGuidance(
  codexHome: string,
  plans: InstallPlan[],
  force: boolean,
): Promise<PreparedText> {
  const path = await codexGuidancePath(codexHome);
  let content = (await readOptionalText(path)) ?? '';

  for (const plan of plans) {
    content = upsertCodexRule(content, plan.resource, force);
  }

  return { path, content };
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
  const entry = resource.files.find((file) => file.path === 'RULE.md');

  if (!entry) {
    throw new Error(`Rule is missing RULE.md: ${resourceKey(resource.resource)}`);
  }

  const key = resourceKey(resource.resource);
  const startMarker = `<!-- ai-directory:rule:${key} -->`;
  const endMarker = `<!-- /ai-directory:rule:${key} -->`;
  const start = contents.indexOf(startMarker);
  const end = contents.indexOf(endMarker);

  if ((start === -1) !== (end === -1) || (start !== -1 && end < start)) {
    throw new Error(`Codex managed rule block is malformed: ${key}`);
  }

  const block = [
    startMarker,
    entry.content.endsWith('\n') ? entry.content : `${entry.content}\n`,
    endMarker,
  ].join('\n');

  if (start !== -1 && end !== -1) {
    if (!force) {
      throw new Error(`Codex rule is already installed: ${key}. Use --force to overwrite.`);
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

function safeDestination(root: string, resourcePath: string): string {
  const destination = resolve(root, resourcePath);
  const relativePath = relative(resolve(root), destination);

  if (!relativePath || isAbsolute(relativePath) || relativePath.startsWith('..')) {
    throw new Error(`Unsafe resource file path: ${resourcePath}`);
  }

  return destination;
}

function toPosixPath(path: string): string {
  return path.split(sep).join('/');
}

function configuredPath(options: InstallOptions, key: string): string | undefined {
  const value = options.environment?.[key] ?? process.env[key];
  return value?.trim() ? resolve(value) : undefined;
}

async function readOptionalText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }

    throw error;
  }
}

async function writeTextAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;

  try {
    await writeFile(temporaryPath, content, 'utf8');
    await rename(temporaryPath, path);
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

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
