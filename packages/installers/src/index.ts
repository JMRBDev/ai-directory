import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { resourceKey } from '@ai-directory/domain';
import type { ResourceVersion } from '@ai-directory/registry';
import { applyEdits, modify, parse } from 'jsonc-parser';
import {
  resolveHarnessPaths,
  type Harness,
} from './harnesses.js';

export type {
  Harness,
  HarnessDefinition,
  HarnessDetection,
  HarnessLocation,
  HarnessPaths,
  HarnessPathContext,
  HarnessPathOptions,
} from './harnesses.js';

export type InstallScope = 'project' | 'global';

export type InstallOptions = {
  scope: InstallScope;
  cwd?: string;
  homeDirectory?: string;
  force?: boolean;
  dryRun?: boolean;
  environment?: NodeJS.ProcessEnv;
};

export type ClaudeCodeInstallOptions = InstallOptions;

export type InstallResult = {
  destination: string;
  files: string[];
  paths: string[];
  ownedPaths: string[];
  fileHashes: Record<string, string>;
  changes?: InstallChange[];
};

export type InstallChange = {
  path: string;
  content: string | null;
};

export type InstallationRecord = {
  resource: string;
  version: string;
  harness: Harness;
  scope: InstallScope;
  destination: string;
  files: string[];
  fileHashes?: Record<string, string>;
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

export { getHarnessDefinition, getHarnessDefinitions } from './harnesses.js';
export { resolveHarnessPaths };
export { detectHarnesses } from './harnesses.js';

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
  await writeInstallPlans(plans, options.dryRun ?? false);

  if (config && !options.dryRun) {
    await writeTextAtomic(config.path, config.content);
  }

  const fileHashes = await hashInstallPlans(plans);

  return plans.map((plan) => ({
    destination: plan.destination,
    files: plan.resource.files.map((file) => file.path),
    paths: [
      ...plan.files.map((file) => file.destination),
      ...(plan.resource.resource.type === 'rules' && config ? [config.path] : []),
    ],
    ownedPaths: plan.files.map((file) => file.destination),
    fileHashes: hashesForPlan(plan, fileHashes),
    ...(options.dryRun
      ? {
          changes: [
            ...plan.files.map((file) => ({ path: file.destination, content: file.content })),
            ...(plan.resource.resource.type === 'rules' && config
              ? [{ path: config.path, content: config.content }]
              : []),
          ],
        }
      : {}),
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
  await writeInstallPlans(plans, options.dryRun ?? false);

  if (guidance && !options.dryRun) {
    await writeTextAtomic(guidance.path, guidance.content);
  }

  const fileHashes = await hashInstallPlans(plans);

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
    ownedPaths: plan.files.map((file) => file.destination),
    fileHashes: hashesForPlan(plan, fileHashes),
    ...(options.dryRun
      ? {
          changes: [
            ...plan.files.map((file) => ({ path: file.destination, content: file.content })),
            ...(plan.resource.resource.type === 'rules' && guidance
              ? [{ path: guidance.path, content: guidance.content }]
              : []),
          ],
        }
      : {}),
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
  await writeInstallPlans(plans, options.dryRun ?? false);

  const fileHashes = await hashInstallPlans(plans);

  return plans.map((plan) => ({
    destination: plan.destination,
    files: plan.resource.files.map((file) => file.path),
    paths: plan.files.map((file) => file.destination),
    ownedPaths: plan.files.map((file) => file.destination),
    fileHashes: hashesForPlan(plan, fileHashes),
    ...(options.dryRun
      ? { changes: [...plan.files.map((file) => ({ path: file.destination, content: file.content }))] }
      : {}),
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

async function writeInstallPlans(plans: InstallPlan[], dryRun: boolean): Promise<void> {
  if (dryRun) return;

  for (const plan of plans) {
    for (const file of plan.files) {
      await mkdir(dirname(file.destination), { recursive: true });
      await writeFile(file.destination, file.content, 'utf8');
    }
  }
}

async function hashInstallPlans(plans: InstallPlan[]): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};

  for (const plan of plans) {
    for (const file of plan.files) {
      hashes[file.destination] = hashContent(file.content);
    }
  }

  return hashes;
}

function hashesForPlan(
  plan: InstallPlan,
  hashes: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const file of plan.files) {
    const hash = hashes[file.destination];
    if (hash) result[file.destination] = hash;
  }

  return result;
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

async function hashFile(path: string): Promise<string | null> {
  try {
    return hashContent(await readFile(path, 'utf8'));
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
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

export function createInstallationRecords(
  resources: ResourceVersion[],
  installations: InstallResult[],
  scope: InstallScope,
  harness: Harness,
): InstallationRecord[] {
  const installedAt = new Date().toISOString();

  return resources.map((resource, index) => {
    const installation = installations[index];

    if (!installation) {
      throw new Error(`Installation result missing for ${resourceKey(resource.resource)}.`);
    }

    return {
      resource: resourceKey(resource.resource),
      version: resource.version,
      harness,
      scope,
      destination: installation.destination,
      files: installation.ownedPaths,
      fileHashes: installation.fileHashes,
      installedAt,
    };
  });
}

export async function saveInstallationRecords(
  path: string,
  records: InstallationRecord[],
  options: InstallOptions,
): Promise<InstallationManifest> {
  const current = await readInstallationManifest(path);
  const keys = new Set(records.map(installationKey));
  const previous = current.installations.filter((record) => keys.has(installationKey(record)));

  await removeStaleInstallationFiles(
    previous,
    records.flatMap((record) => record.files),
    options,
  );

  return updateInstallationManifest(path, records);
}

export async function removeInstallationRecord(
  path: string,
  target: InstallationRecord,
): Promise<InstallationManifest> {
  const current = await readInstallationManifest(path);
  const manifest = {
    schemaVersion: 1 as const,
    installations: current.installations.filter(
      (record) => installationKey(record) !== installationKey(target),
    ),
  };

  await writeTextAtomic(path, `${JSON.stringify(manifest, null, 2)}\n`);

  return manifest;
}

export async function assertInstallationFilesUnchanged(
  record: InstallationRecord,
  force = false,
): Promise<void> {
  if (force) return;

  if (!record.fileHashes) {
    throw new Error(
      `Installation ${record.resource} has no ownership hashes. Reinstall it with --force before updating or uninstalling.`,
    );
  }

  const changed: string[] = [];

  for (const path of record.files) {
    const expected = record.fileHashes[path];

    if (!expected) {
      changed.push(path);
      continue;
    }

    const actual = await hashFile(path);
    if (actual !== null && actual !== expected) changed.push(path);
  }

  if (changed.length > 0) {
    throw new Error(
      `Installation files were modified: ${changed.join(', ')}. Use --force to continue.`,
    );
  }
}

export async function uninstallInstallation(
  record: InstallationRecord,
  options: InstallOptions,
): Promise<InstallChange[]> {
  const files = await ownedInstallationFiles(record, options);
  const normalized: InstallationRecord = {
    ...record,
    files,
    ...(record.fileHashes
      ? { fileHashes: selectHashes(files, record.fileHashes) }
      : {}),
  };

  await assertInstallationFilesUnchanged(normalized, options.force ?? false);
  const sharedChanges = await removeSharedConfiguration(record, options);

  if (!options.dryRun) {
    for (const change of sharedChanges) {
      if (change.content !== null) await writeTextAtomic(change.path, change.content);
    }
    await Promise.all(files.map((path) => rm(path, { force: true })));
  }

  return [
    ...sharedChanges,
    ...files.map((path) => ({ path, content: null })),
  ];
}

export async function removeStaleInstallationFiles(
  previous: InstallationRecord[],
  currentFiles: string[],
  options?: InstallOptions,
): Promise<void> {
  const keep = new Set(currentFiles);

  for (const record of previous) {
    const files = await ownedInstallationFiles(record, options ?? { scope: record.scope });
    const stale = files.filter((path) => !keep.has(path));

    if (stale.length === 0) continue;

    const staleRecord: InstallationRecord = {
      ...record,
      files: stale,
      ...(record.fileHashes
        ? { fileHashes: selectHashes(stale, record.fileHashes) }
        : {}),
    };

    await assertInstallationFilesUnchanged(staleRecord, options?.force ?? false);
    await Promise.all(stale.map((path) => rm(path, { force: true })));
  }
}

async function ownedInstallationFiles(
  record: InstallationRecord,
  options?: InstallOptions,
): Promise<string[]> {
  if (record.fileHashes) return record.files;

  const files = new Set(record.files);
  const type = resourceType(record.resource);

  if (type === 'rules' && record.harness === 'codex') {
    files.delete(record.destination);
  }

  if (type === 'rules' && record.harness === 'opencode') {
    const installOptions = options ?? { scope: record.scope };
    const root = openCodeInstallRoot(installOptions);
    const configPath = await openCodeConfigPath(root, record.scope, installOptions);
    files.delete(configPath);
  }

  return [...files];
}

function selectHashes(
  paths: string[],
  hashes: Record<string, string>,
): Record<string, string> {
  const selected: Record<string, string> = {};

  for (const path of paths) {
    const hash = hashes[path];
    if (hash) selected[path] = hash;
  }

  return selected;
}

async function removeSharedConfiguration(
  record: InstallationRecord,
  options: InstallOptions,
): Promise<InstallChange[]> {
  const type = resourceType(record.resource);

  if (type !== 'rules') return [];

  if (record.harness === 'opencode') {
    const change = await removeOpenCodeInstruction(record, options);
    return change ? [change] : [];
  } else if (record.harness === 'codex') {
    const change = await removeCodexGuidance(record);
    return change ? [change] : [];
  }

  return [];
}

async function removeOpenCodeInstruction(
  record: InstallationRecord,
  options: InstallOptions,
): Promise<InstallChange | null> {
  const root = openCodeInstallRoot(options);
  const path = await openCodeConfigPath(root, record.scope, options);
  const current = await readOptionalText(path);

  if (current === null) return null;

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

  if (!Array.isArray(currentInstructions)) return null;

  const entry = toPosixPath(relative(dirname(path), record.destination));
  if (!currentInstructions.includes(entry)) return null;

  return {
    path,
    content: applyEdits(
      current,
      modify(
        current,
        ['instructions'],
        currentInstructions.filter((value) => value !== entry),
        { formattingOptions: { insertSpaces: true, tabSize: 2 } },
      ),
    ),
  };
}

async function removeCodexGuidance(record: InstallationRecord): Promise<InstallChange | null> {
  const current = await readOptionalText(record.destination);

  if (current === null) return null;

  const key = record.resource;
  const startMarker = `<!-- ai-directory:rule:${key} -->`;
  const endMarker = `<!-- /ai-directory:rule:${key} -->`;
  const start = current.indexOf(startMarker);
  const end = current.indexOf(endMarker);

  if (start === -1 && end === -1) return null;

  if ((start === -1) !== (end === -1) || end < start) {
    throw new Error(`Codex managed rule block is malformed: ${key}`);
  }

  const before = current.slice(0, start);
  const after = current.slice(end + endMarker.length);
  const cleanedBefore = before.endsWith('\n\n') ? before.slice(0, -1) : before;
  const cleanedAfter = after.startsWith('\n') ? after.slice(1) : after;
  return {
    path: record.destination,
    content: `${cleanedBefore}${cleanedAfter}`,
  };
}

function resourceType(resource: string): ResourceKind | undefined {
  const type = resource.split('/')[1];
  return type === 'skills' || type === 'agents' || type === 'rules'
    ? type
    : undefined;
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
    (!('fileHashes' in value) ||
      (typeof value.fileHashes === 'object' &&
        value.fileHashes !== null &&
        !Array.isArray(value.fileHashes) &&
        Object.values(value.fileHashes).every((hash) => typeof hash === 'string'))) &&
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
  skillsRoot: string;
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
  return resolveHarnessPaths('claude-code', options)[options.scope].config;
}

function openCodeInstallRoot(options: InstallOptions): string {
  return resolveHarnessPaths('opencode', options)[options.scope].root;
}

function codexInstallPaths(options: InstallOptions): CodexInstallPaths {
  const location = resolveHarnessPaths('codex', options)[options.scope];

  return {
    root: location.root,
    codexHome: location.config,
    skillsRoot: location.skills,
    guidanceRoot: location.guidance,
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
    return join(paths.skillsRoot, resource.resource.name);
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
