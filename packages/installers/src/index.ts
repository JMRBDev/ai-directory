import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, rm, rmdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  configuredPath,
  getScopeInstallManifestPath,
  isMissingPathError,
  isPathExistsError,
  pathExists,
  writeFileAtomic,
  type ConfigScope,
} from '@ai-directory/config';
export { isMissingPathError, pathExists } from '@ai-directory/config';
import { resourceKey } from '@ai-directory/contracts';
import { readToolManifest, type ResourceFile, type ResourceVersion } from '@ai-directory/registry';
import { applyEdits, modify, parse } from 'jsonc-parser';
import { z } from 'zod';
import {
  resolveHarnessPaths,
  type Harness,
} from './harnesses.js';
import {
  toolDependencyRecordsForResources,
  toolDependencyRemovalCandidates,
  toolDependencyRemovalCandidatesForInstallResults,
  installToolDependencies,
  restoreToolDependencies,
  uninstallToolDependencies,
  type DependencyCommandRunner,
  type ToolDependencyInstallResult,
  type ToolDependencyOptions,
  type ToolDependencyRecord,
  type ToolDependencyRemovalCandidate,
  type ToolDependencyUninstallResult,
} from './dependencies.js';
export * from './dependencies.js';

export type {
  Harness,
  HarnessDefinition,
  HarnessDetection,
  HarnessLocation,
  HarnessPathContext,
  HarnessPathOptions,
} from './harnesses.js';

export type InstallOptions = {
  cwd?: string;
  homeDirectory?: string;
  force?: boolean;
  dryRun?: boolean;
  scope?: ConfigScope;
  environment?: NodeJS.ProcessEnv;
  installDependencies?: boolean;
  removeDependencies?: boolean;
  dependencyCommandRunner?: DependencyCommandRunner;
  installationOwner?: string;
};

export type InstallResult = {
  destination: string;
  files: string[];
  skippedFiles: string[];
  paths: string[];
  ownedPaths: string[];
  fileHashes: Record<string, string>;
  shared?: SharedOwnership[] | undefined;
  changes?: InstallChange[];
};

export type InstallChange = {
  path: string;
  content: string | null;
};

export type SharedOwnership = {
  path: string;
  key: string;
  hash: string;
  created?: boolean | undefined;
};

export interface ResourceOperation {
  resource: string;
  harnesses: Harness[];
  action: 'install' | 'uninstall';
  version?: string;
  resources?: ResourceVersion[];
  resourceIds?: string[];
  pack?: ResourcePackOperation;
  warningResources?: ResourceVersion[];
}

export type ResourcePackEntry = {
  resource: string;
  version: string;
};

export type ResourcePackOperation = {
  version: string;
  resources: ResourcePackEntry[];
};

export type PlannedResourceChange = {
  path: string;
  action: 'added' | 'modified' | 'removed';
  resource: string;
  harness: Harness;
  before?: string;
  after?: string;
};

export type ResourceChangePlan = {
  operations: ResourceOperation[];
  changes: PlannedResourceChange[];
  conflicts: string[];
  warnings: string[];
  projectionNotes: string[];
  dependencyRemovals: ToolDependencyRemovalCandidate[];
  fingerprint: string;
};

export type ResourceChangeOptions = Pick<
  InstallOptions,
  | 'cwd'
  | 'homeDirectory'
  | 'environment'
  | 'scope'
  | 'installDependencies'
  | 'removeDependencies'
  | 'dependencyCommandRunner'
  | 'installationOwner'
>;

export type ResourceApplyResult = {
  plan: ResourceChangePlan;
  installed: InstallationRecord[];
  removed: InstallationRecord[];
  warnings: string[];
  dependencies: ToolDependencyInstallResult[];
  removedDependencies: ToolDependencyUninstallResult[];
  dependencyRemovals: ToolDependencyRemovalCandidate[];
};

const sharedOwnershipSchema = z.object({
  path: z.string().min(1),
  key: z.string().min(1),
  hash: z.string().min(1),
  created: z.boolean().optional(),
});

export const installationRecordSchema = z.object({
  resource: z.string().min(1),
  version: z.string().min(1),
  harness: z.enum(['claude-code', 'opencode', 'codex']),
  destination: z.string().min(1),
  files: z.array(z.string().min(1)),
  fileHashes: z.record(z.string(), z.string()).optional(),
  shared: z.array(sharedOwnershipSchema).optional(),
  owners: z.array(z.string().min(1)).min(1).optional(),
  kind: z.enum(['files', 'mcp']).optional(),
  scope: z.enum(['user', 'project']).optional(),
  installedAt: z.string().min(1),
});

const installationPackEntrySchema = z.object({
  resource: z.string().min(1),
  version: z.string().min(1),
});

export const installationPackRecordSchema = z.object({
  resource: z.string().min(1),
  version: z.string().min(1),
  harness: z.enum(['claude-code', 'opencode', 'codex']),
  resources: z.array(installationPackEntrySchema).min(1),
  installedAt: z.string().min(1),
});

export type InstallationPackRecord = z.infer<typeof installationPackRecordSchema>;

const toolDependencyRecordSchema = z.object({
  resource: z.string().min(1),
  command: z.string().min(1),
  manager: z.enum(['homebrew', 'pipx', 'npm', 'cargo']),
  package: z.string().min(1),
  version: z.string().min(1).optional(),
  installedAt: z.string().min(1),
});

export type InstallationRecord = z.infer<typeof installationRecordSchema>;

export const installationManifestSchema = z.object({
  schemaVersion: z.literal(1),
  installations: z.array(installationRecordSchema),
  dependencies: z.array(toolDependencyRecordSchema).default([]),
  packs: z.array(installationPackRecordSchema).default([]),
});

export type InstallationManifest = {
  schemaVersion: 1;
  installations: InstallationRecord[];
  dependencies: ToolDependencyRecord[];
  packs: InstallationPackRecord[];
};
export type { ToolDependencyRecord };

export type ResourceInstallationMode = 'native' | 'translated' | 'configured';

export type ResourceKind = Exclude<ResourceVersion['resource']['type'], 'templates'>;

export type HarnessAdapter = {
  harness: Harness;
  installation: 'native-filesystem';
  capabilities: Record<ResourceKind, ResourceInstallationMode>;
  install(resources: ResourceVersion[], options: InstallOptions): Promise<InstallResult[]>;
};

export function getHarnessAdapter(value: string): HarnessAdapter {
  if (value !== 'claude-code' && value !== 'opencode' && value !== 'codex') {
    throw new Error(`Unsupported harness: ${value}`);
  }

  return harnessAdapters[value];
}

export { getHarnessDefinition, getHarnessDefinitions } from './harnesses.js';
export { resolveHarnessPaths };
export { detectHarnesses } from './harnesses.js';
export { discoverLocalResources } from './discovery.js';
export { enrichLocalResources } from './discovery.js';
export type {
  LocalResource,
  LocalResourceRegistryState,
  LocalResourceState,
  ResourceDiscoveryOptions,
} from './discovery.js';
export * from './mcp.js';

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

  await assertInstallPlansAvailable(plans, options);
  await writeInstallPlans(plans, options.dryRun ?? false);

  if (config && !options.dryRun) {
    await writeFileAtomic(config.path, config.content);
  }

  const fileHashes = await hashInstallPlans(plans);

  return plans.map((plan) => {
    const result: InstallResult = {
      destination: plan.destination,
      files: plan.files.map((file) => file.path),
      skippedFiles: plan.skippedFiles,
      paths: [
        ...plan.files.map((file) => file.destination),
        ...(plan.resource.resource.type === 'rules' && config ? [config.path] : []),
      ],
      ownedPaths: plan.files.map((file) => file.destination),
      fileHashes: selectHashes(plan.files.map((file) => file.destination), fileHashes),
      shared: config?.ownership?.filter((ownership) =>
        ownership.key === resourceKey(plan.resource.resource),
      ),
    };
    if (options.dryRun) {
      result.changes = [
        ...plan.files.map((file) => ({ path: file.destination, content: file.content })),
        ...(plan.resource.resource.type === 'rules' && config
          ? [{ path: config.path, content: config.content }]
          : []),
      ];
    }
    return result;
  });
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
    ? await prepareCodexMarketplace(paths, plugins, options.force ?? false)
    : undefined;

  await assertInstallPlansAvailable(plans, options);
  await writeInstallPlans(plans, options.dryRun ?? false);

  if (guidance && !options.dryRun) {
    await writeFileAtomic(guidance.path, guidance.content);
  }

  if (marketplace && !options.dryRun) {
    await writeFileAtomic(marketplace.path, marketplace.content);
  }

  const fileHashes = await hashInstallPlans(plans);

  return plans.map((plan) => {
    const isPlugin = isPluginBundle(plan.resource);
    const result: InstallResult = {
      destination:
        plan.resource.resource.type === 'rules' && guidance
          ? guidance.path
          : plan.destination,
      files: plan.files.map((file) => file.path),
      skippedFiles: plan.skippedFiles,
      paths: [
        ...plan.files.map((file) => file.destination),
        ...(plan.resource.resource.type === 'rules' && guidance ? [guidance.path] : []),
        ...(isPlugin && marketplace ? [marketplace.path] : []),
      ],
      ownedPaths: plan.files.map((file) => file.destination),
      fileHashes: selectHashes(plan.files.map((file) => file.destination), fileHashes),
      shared: [
        ...(guidance?.ownership?.filter((ownership) =>
          ownership.key === resourceKey(plan.resource.resource),
        ) ?? []),
        ...(marketplace?.ownership?.filter((ownership) =>
          ownership.key === resourceKey(plan.resource.resource),
        ) ?? []),
      ],
    };
    if (options.dryRun) {
      result.changes = [
        ...plan.files.map((file) => ({ path: file.destination, content: file.content })),
        ...(plan.resource.resource.type === 'rules' && guidance
          ? [{ path: guidance.path, content: guidance.content }]
          : []),
        ...(isPlugin && marketplace
          ? [{ path: marketplace.path, content: marketplace.content }]
          : []),
      ];
    }
    return result;
  });
}

async function assertInstallPlansAvailable(
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

async function writeInstallPlans(plans: InstallPlan[], dryRun: boolean): Promise<void> {
  if (dryRun) return;

  for (const plan of plans) {
    for (const file of plan.files) {
      await writeFileAtomic(file.destination, file.content);
      if (file.mode !== undefined) await chmod(file.destination, file.mode);
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

function selectHashes(
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

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function hashFile(path: string): Promise<string | null> {
  try {
    return hashContent(await readFile(path, 'utf8'));
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
}

const claudeCodeInstaller: HarnessAdapter = {
  harness: 'claude-code',
  installation: 'native-filesystem',
  capabilities: {
    skills: 'native',
    agents: 'native',
    rules: 'native',
    'mcp-servers': 'configured',
    plugins: 'native',
    tools: 'native',
  },
  install: installClaudeCodeResources,
};

export const openCodeInstaller: HarnessAdapter = {
  harness: 'opencode',
  installation: 'native-filesystem',
  capabilities: {
    skills: 'native',
    agents: 'translated',
    rules: 'configured',
    'mcp-servers': 'configured',
    plugins: 'native',
    tools: 'native',
  },
  install: installOpenCodeResources,
};

const codexInstaller: HarnessAdapter = {
  harness: 'codex',
  installation: 'native-filesystem',
  capabilities: {
    skills: 'native',
    agents: 'translated',
    rules: 'configured',
    'mcp-servers': 'configured',
    plugins: 'configured',
    tools: 'configured',
  },
  install: installCodexResources,
};

const harnessAdapters = {
  'claude-code': claudeCodeInstaller,
  opencode: openCodeInstaller,
  codex: codexInstaller,
} satisfies Record<Harness, HarnessAdapter>;

export async function readInstallationManifest(path: string): Promise<InstallationManifest> {
  let data: unknown;

  try {
    data = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (isMissingPathError(error)) {
      return { schemaVersion: 1, installations: [], dependencies: [], packs: [] };
    }
    throw new Error(`Installation manifest is not valid JSON: ${path}`, { cause: error });
  }

  const result = installationManifestSchema.safeParse(data);

  if (!result.success) {
    throw new Error(`Installation manifest is invalid: ${path}`);
  }

  const dependencies = result.data.dependencies.map((record) => {
    const dependency: ToolDependencyRecord = {
      resource: record.resource,
      command: record.command,
      manager: record.manager,
      package: record.package,
      installedAt: record.installedAt,
    };
    if (record.version !== undefined) dependency.version = record.version;
    return dependency;
  });

  return {
    schemaVersion: result.data.schemaVersion,
    installations: result.data.installations,
    dependencies,
    packs: result.data.packs,
  };
}

export function assertInstalledFor(
  manifest: InstallationManifest,
  resources: string[],
  harnesses: Harness[],
  resource: string,
): void {
  const missing = harnesses.filter((harness) =>
    resources.some(
      (id) =>
        !manifest.installations.some(
          (record) => record.resource === id && record.harness === harness,
        ),
    ),
  );

  if (missing.length > 0) {
    throw new Error(`${resource} is not installed for ${missing.join(', ')}.`);
  }
}

export async function updateInstallationManifest(
  path: string,
  records: InstallationRecord[],
): Promise<InstallationManifest> {
  const keys = new Set(records.map(installationKey));

  return rewriteInstallationManifest(path, (current) => [
    ...current.filter((record) => !keys.has(installationKey(record))),
    ...records,
  ]);
}

export async function updateInstallationPackRecords(
  path: string,
  records: InstallationPackRecord[],
): Promise<InstallationManifest> {
  const keys = new Set(records.map(installationKey));

  return rewriteFullInstallationManifest(path, (current) => ({
    ...current,
    packs: [
      ...current.packs.filter((record) => !keys.has(installationKey(record))),
      ...records,
    ],
  }));
}

export async function removeInstallationPackRecords(
  path: string,
  records: Array<Pick<InstallationPackRecord, 'resource' | 'harness'>>,
): Promise<InstallationManifest> {
  const keys = new Set(records.map(installationKey));

  return rewriteFullInstallationManifest(path, (current) => ({
    ...current,
    packs: current.packs.filter((record) => !keys.has(installationKey(record))),
  }));
}

export function createInstallationRecords(
  resources: ResourceVersion[],
  installations: InstallResult[],
  harness: Harness,
  owner?: string,
): InstallationRecord[] {
  const installedAt = new Date().toISOString();

  return resources.map((resource, index) => {
    const installation = installations[index];

    if (!installation) {
      throw new Error(`Installation result missing for ${resourceKey(resource.resource)}.`);
    }

    const record: InstallationRecord = {
      resource: resourceKey(resource.resource),
      version: resource.version,
      harness,
      destination: installation.destination,
      files: installation.ownedPaths,
      fileHashes: installation.fileHashes,
      owners: [owner ?? resourceKey(resource.resource)],
      installedAt,
    };
    if (installation.shared && installation.shared.length > 0) {
      record.shared = installation.shared;
    }
    return record;
  });
}

function mergeSharedOwnership(
  existing: SharedOwnership[] | undefined,
  incoming: SharedOwnership[] | undefined,
): SharedOwnership[] | undefined {
  if (!existing && !incoming) return undefined;

  const merged = new Map(
    (existing ?? []).map((ownership) => [`${ownership.path}:${ownership.key}`, ownership]),
  );
  for (const ownership of incoming ?? []) {
    merged.set(`${ownership.path}:${ownership.key}`, ownership);
  }

  return merged.size > 0 ? [...merged.values()] : undefined;
}

async function saveInstallationRecords(
  path: string,
  records: InstallationRecord[],
  options: InstallOptions,
): Promise<InstallationManifest> {
  const current = await readInstallationManifest(path);
  const keys = new Set(records.map(installationKey));
  const previous = current.installations.filter((record) => keys.has(installationKey(record)));
  const merged = records.map((record) => {
    const existing = previous.find((item) => installationKey(item) === installationKey(record));
    if (!existing) return record;

    return {
      ...record,
      shared: mergeSharedOwnership(existing.shared, record.shared),
      owners: [...new Set([...installationOwners(existing), ...installationOwners(record)])],
    };
  });

  await removeStaleInstallationFiles(
    previous,
    merged.flatMap((record) => record.files),
    options,
  );

  return updateInstallationManifest(path, merged);
}

export async function removeInstallationRecord(
  path: string,
  target: InstallationRecord,
): Promise<InstallationManifest> {
  return rewriteInstallationManifest(path, (current) =>
    current.filter((record) => installationKey(record) !== installationKey(target)),
  );
}

export async function updateToolDependencyRecords(
  path: string,
  records: ToolDependencyRecord[],
): Promise<InstallationManifest> {
  const keys = new Set(records.map((record) => `${record.resource}\u0000${record.command}`));
  return rewriteFullInstallationManifest(path, (current) => ({
    ...current,
    dependencies: [
      ...current.dependencies.filter((record) => !keys.has(`${record.resource}\u0000${record.command}`)),
      ...records,
    ],
  }));
}

export async function removeToolDependencyRecords(
  path: string,
  resourceIds: string[],
): Promise<{ manifest: InstallationManifest; candidates: ToolDependencyRemovalCandidate[] }> {
  const current = await readInstallationManifest(path);
  const candidates = toolDependencyRemovalCandidates(current.dependencies, resourceIds);
  const removing = new Set(resourceIds);
  const manifest = await rewriteFullInstallationManifest(path, (latest) => ({
    ...latest,
    dependencies: latest.dependencies.filter((record) => !removing.has(record.resource)),
  }));
  return { manifest, candidates };
}

async function rewriteInstallationManifest(
  path: string,
  select: (records: InstallationRecord[]) => InstallationRecord[],
): Promise<InstallationManifest> {
  return rewriteFullInstallationManifest(path, (current) => ({
    ...current,
    installations: select(current.installations),
  }));
}

async function rewriteFullInstallationManifest(
  path: string,
  select: (manifest: InstallationManifest) => InstallationManifest,
): Promise<InstallationManifest> {
  const current = await readInstallationManifest(path);
  const manifest = select(current);

  await writeFileAtomic(path, `${JSON.stringify(manifest, null, 2)}\n`);

  return manifest;
}

async function assertInstallationFilesUnchanged(
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
  if (options.installationOwner && !willRemoveInstallation(record, options.installationOwner)) {
    return [];
  }

  const files = await ownedInstallationFiles(record, options);
  const normalized: InstallationRecord = {
    ...record,
    files,
  };
  if (record.fileHashes) {
    normalized.fileHashes = selectHashes(files, record.fileHashes);
  }

  await assertInstallationFilesUnchanged(normalized, options.force ?? false);
  const sharedChanges = await removeSharedConfiguration(record, options);

  if (!options.dryRun) {
    for (const change of sharedChanges) {
      if (change.content === null) await rm(change.path, { force: true });
      else await writeFileAtomic(change.path, change.content);
    }
    await Promise.all(files.map((path) => rm(path, { force: true })));
    await removeEmptyInstallationDirectories(record, files);
  }

  return [
    ...sharedChanges,
    ...files.map((path) => ({ path, content: null })),
  ];
}

function installationOwners(record: InstallationRecord): string[] {
  return record.owners && record.owners.length > 0
    ? record.owners
    : [record.resource];
}

function removeInstallationOwner(
  record: InstallationRecord,
  owner?: string,
): InstallationRecord | null {
  if (!owner) return null;

  const remaining = installationOwners(record).filter((value) => value !== owner);
  if (remaining.length === installationOwners(record).length) return record;
  if (remaining.length === 0) return null;
  return { ...record, owners: remaining };
}

function willRemoveInstallation(record: InstallationRecord, owner?: string): boolean {
  return removeInstallationOwner(record, owner) === null;
}

export async function planResourceOperations(
  operations: ResourceOperation[],
  options: ResourceChangeOptions = {},
  force = false,
): Promise<ResourceChangePlan> {
  const changes: PlannedResourceChange[] = [];
  const conflicts: string[] = [];
  const warnings: string[] = [];
  const projectionNotes: string[] = [];
  const contents = new Map<string, string | null>();

  async function addChange(
    change: InstallChange,
    operation: ResourceOperation,
    resource: string,
    harness: Harness,
  ) {
    const before = contents.has(change.path)
      ? contents.get(change.path) ?? null
      : await currentFile(change.path);
    contents.set(change.path, before);
    const action = classifyChange(before, change.content);
    if (!action) return;

    const existing = changes.find((item) => item.path === change.path);
    if (existing) {
      if (existing.after !== previewContent(change.content)) {
        conflicts.push(`Multiple changes target ${change.path}.`);
      }
      return;
    }

    const planned: PlannedResourceChange = {
      path: change.path,
      action,
      resource,
      harness,
    };
    const beforePreview = previewContent(before);
    const afterPreview = previewContent(change.content);
    if (beforePreview !== undefined) planned.before = beforePreview;
    if (afterPreview !== undefined) planned.after = afterPreview;
    changes.push(planned);
  }

  const installGroups = new Map<string, {
    resources: ResourceVersion[];
    owners: Map<string, ResourceOperation>;
  }>();

  for (const operation of operations) {
    if (operation.action !== 'install') continue;
    if (!operation.resources || operation.resources.length === 0) {
      throw new Error(`Install operation has no resources: ${operation.resource}.`);
    }

    for (const harness of operation.harnesses) {
      const group = installGroups.get(harness) ?? {
        resources: [],
        owners: new Map<string, ResourceOperation>(),
      };
      for (const resource of operation.resources) {
        const id = resourceKey(resource.resource);
        if (!group.owners.has(id)) {
          group.resources.push(resource);
          group.owners.set(id, operation);
        }
      }
      installGroups.set(harness, group);
    }
  }

  const processedInstallGroups = new Set<string>();
  const processedPackStale = new Set<string>();

  for (const operation of operations) {
    const resourceIds = operation.resourceIds ?? operation.resources?.map((item) => resourceKey(item.resource)) ?? [];
    warnings.push(...requestWarnings(operation.warningResources ?? operation.resources ?? []));
    const manifestPath = installationManifestPath(options);
    const manifest = await readInstallationManifest(manifestPath);

    for (const harness of operation.harnesses) {
      const records = manifest.installations.filter(
        (record) =>
          record.harness === harness &&
          resourceIds.includes(record.resource),
      );

      for (const record of records) {
        if (operation.action === 'uninstall' && operation.pack && !willRemoveInstallation(record, operation.resource)) {
          continue;
        }
        try {
          await assertInstallationFilesUnchanged(record, force);
        } catch (error) {
          conflicts.push(`${record.resource} (${harness}): ${errorMessage(error)}`);
        }
      }

      if (operation.action === 'install') {
        if (operation.pack) {
          const staleKey = `${harness}:${operation.resource}`;
          const previousPack = manifest.packs.find((pack) =>
            pack.resource === operation.resource && pack.harness === harness,
          );
          if (previousPack && !processedPackStale.has(staleKey)) {
            processedPackStale.add(staleKey);
            const currentResources = new Set(
              operation.pack.resources.map((entry) => entry.resource),
            );
            const staleResources = new Set(
              previousPack.resources
                .map((entry) => entry.resource)
                .filter((resource) => !currentResources.has(resource)),
            );
            const staleRecords = manifest.installations.filter((record) =>
              record.harness === harness && staleResources.has(record.resource),
            );
            for (const record of staleRecords) {
              try {
                const staleChanges = await uninstallInstallation(
                  record,
                  operationInstallOptions(options, force, true, operation.resource),
                );
                for (const change of staleChanges) {
                  await addChange(change, operation, record.resource, harness);
                }
              } catch (error) {
                conflicts.push(`${record.resource} (${harness}): ${errorMessage(error)}`);
              }
            }
          }
        }
        if (processedInstallGroups.has(harness)) continue;
        processedInstallGroups.add(harness);
        const group = installGroups.get(harness);
        const resources = group?.resources ?? operation.resources ?? [];
        const installer = getHarnessAdapter(harness);
        const results = await installer.install(
          resources,
          operationInstallOptions(options, true, true),
        );

        for (const [index, result] of results.entries()) {
          const plannedResource = resources[index];
          const resourceId = plannedResource ? resourceKey(plannedResource.resource) : operation.resource;
          const owner = group?.owners.get(resourceId) ?? operation;
          const otherInstallations = manifest.installations.filter(
            (record) => record.harness === harness && record.resource !== resourceId,
          );
          const occupiedPaths = otherInstallations.flatMap((record) => [
            record.destination,
            ...record.files,
          ]);
          if (!force) {
            const resourceDestination = plannedResource?.resource.type === 'rules' && harness === 'codex'
              ? undefined
              : result.destination;
            const managedByCurrentResource = resourceDestination
              ? manifest.installations.some((record) =>
                  record.harness === harness
                  && record.resource === resourceId
                  && pathsOverlap(record.destination, resourceDestination),
                )
              : false;
            if (
              resourceDestination
              && (await pathExists(resourceDestination))
              && !managedByCurrentResource
            ) {
              conflicts.push(
                `Install destination is already occupied: ${resourceDestination}. Use --force to overwrite.`,
              );
            }
            for (const path of result.ownedPaths) {
              if (occupiedPaths.some((occupiedPath) => pathsOverlap(occupiedPath, path))) {
                conflicts.push(`Install destination is already occupied: ${path}. Use --force to overwrite.`);
                continue;
              }
              if ((await currentFile(path)) === null) continue;
              conflicts.push(`Install destination is already occupied: ${path}. Use --force to overwrite.`);
            }
          }
          for (const change of result.changes ?? []) {
            await addChange(change, owner, resourceId, harness);
          }
          if (result.skippedFiles.length > 0) {
            projectionNotes.push(
              `${resourceId} · ${harness}: omitted harness-specific files (${result.skippedFiles.join(', ')}).`,
            );
          }

          const previous = manifest.installations.find(
            (record) =>
              record.resource === resourceId &&
              record.harness === harness,
          );
          if (previous) {
            const currentPaths = new Set(result.ownedPaths);
            for (const path of previous.files) {
              if (!currentPaths.has(path)) {
                await addChange({ path, content: null }, owner, resourceId, harness);
              }
            }
          }
        }
      } else {
        for (const record of records) {
          try {
            const result = await uninstallInstallation(
              record,
              operationInstallOptions(
                options,
                force,
                true,
                operation.pack ? operation.resource : undefined,
              ),
            );
            for (const change of result) {
              await addChange(change, operation, record.resource, harness);
            }
          } catch (error) {
            conflicts.push(`${record.resource} (${harness}): ${errorMessage(error)}`);
          }
        }
      }
    }
  }

  const manifest = await readInstallationManifest(installationManifestPath(options));
  const dependencyResourceIds = fullyRemovedResourceIds(operations, manifest.installations);
  const retainedDependencyCommands = operations
    .filter((operation) => operation.action === 'install')
    .flatMap((operation) => operation.resources ?? [])
    .flatMap((resource) => {
      if (resource.resource.type !== 'tools') return [];
      const manifest = readToolManifest(resource);
      return manifest.runtime
        ? [manifest.runtime.command, ...manifest.runtime.dependencies.map((dependency) => dependency.command)]
        : [];
    });
  const dependencyRemovals = dependencyResourceIds.length > 0
    ? toolDependencyRemovalCandidates(
        manifest.dependencies,
        dependencyResourceIds,
        retainedDependencyCommands,
      )
    : [];

  return {
    operations: operations.map(publicOperation),
    changes,
    conflicts: [...new Set(conflicts)],
    warnings: [...new Set(warnings)],
    projectionNotes: [...new Set(projectionNotes)],
    dependencyRemovals,
    fingerprint: await fingerprintPaths(resourcePlanPaths(operations, changes, options)),
  };
}

export async function applyResourceOperations(
  operations: ResourceOperation[],
  options: ResourceChangeOptions = {},
  force = false,
  planned?: ResourceChangePlan,
): Promise<ResourceApplyResult> {
  return applyChangePlanEnvelope(
    operations,
    options,
    force,
    planned,
    () => planResourceOperations(operations, options, force),
    (plan) => resourcePlanPaths(operations, plan.changes, options),
    async (plan) => {
      const installed: InstallationRecord[] = [];
      const removed: InstallationRecord[] = [];
      const warnings = [...plan.warnings];
      const dependencyOptions = dependencyOptionsFrom(options);
      const installingResources = operations
        .filter((operation) => operation.action === 'install')
        .flatMap((operation) => operation.resources ?? []);
      const manifest = await readInstallationManifest(installationManifestPath(options));
      const removingResourceIds = fullyRemovedResourceIds(operations, manifest.installations);
      let dependencies: ToolDependencyInstallResult[] = [];
      let removedDependencies: ToolDependencyUninstallResult[] = [];

      try {
        dependencies = options.installDependencies && installingResources.length > 0
          ? await installToolDependencies(installingResources, dependencyOptions)
          : [];

        for (const operation of operations) {
          try {
            const manifestPath = installationManifestPath(options);
            if (operation.action === 'install') {
              const resources = operation.resources ?? [];
              for (const harness of operation.harnesses) {
                if (operation.pack) {
                  const currentManifest = await readInstallationManifest(manifestPath);
                  const previousPack = currentManifest.packs.find((pack) =>
                    pack.resource === operation.resource && pack.harness === harness,
                  );
                  if (previousPack) {
                    const currentResources = new Set(
                      operation.pack.resources.map((entry) => entry.resource),
                    );
                    const staleResources = new Set(
                      previousPack.resources
                        .map((entry) => entry.resource)
                        .filter((resource) => !currentResources.has(resource)),
                    );
                    const staleRecords = currentManifest.installations.filter((record) =>
                      record.harness === harness && staleResources.has(record.resource),
                    );
                    for (const record of staleRecords) {
                      const remaining = removeInstallationOwner(record, operation.resource);
                      if (remaining) {
                        await updateInstallationManifest(manifestPath, [remaining]);
                      } else {
                        await uninstallInstallation(
                          record,
                          operationInstallOptions(options, force, false, operation.resource),
                        );
                        await removeInstallationRecord(manifestPath, record);
                        removed.push(record);
                      }
                    }
                  }
                }
                const installer = getHarnessAdapter(harness);
                const installations = await installer.install(
                  resources,
                  operationInstallOptions(options, true),
                );
                const records = createInstallationRecords(
                  resources,
                  installations,
                  installer.harness,
                  operation.pack ? operation.resource : undefined,
                );
                const saved = await saveInstallationRecords(
                  manifestPath,
                  records,
                  operationInstallOptions(options, force),
                );
                installed.push(
                  ...records.map((record) =>
                    saved.installations.find((item) => installationKey(item) === installationKey(record)) ?? record,
                  ),
                );
              }
            } else {
              const resourceIds = operation.resourceIds ?? operation.resources?.map((item) => resourceKey(item.resource)) ?? [];
              const manifest = await readInstallationManifest(manifestPath);
              const records = manifest.installations.filter(
                (record) =>
                  operation.harnesses.includes(record.harness) &&
                  resourceIds.includes(record.resource),
              );

              for (const record of records) {
                const owner = operation.pack ? operation.resource : record.resource;
                const remaining = removeInstallationOwner(record, owner);
                if (remaining) {
                  await updateInstallationManifest(manifestPath, [remaining]);
                  continue;
                }
                await uninstallInstallation(
                  record,
                  operationInstallOptions(options, force, false, owner),
                );
                await removeInstallationRecord(manifestPath, record);
                removed.push(record);
              }
            }
          } catch (error) {
            throw new Error(
              `Failed to ${operation.action} ${operation.resource} for ${operation.harnesses.join(', ')}: ${errorMessage(error)}`,
              { cause: error },
            );
          }
        }

        const manifestPath = installationManifestPath(options);
        if (installingResources.length > 0) {
          const manifest = await readInstallationManifest(manifestPath);
          const dependencyRecords = toolDependencyRecordsForResources(
            installingResources,
            dependencies,
            manifest.dependencies,
          );
          await updateToolDependencyRecords(manifestPath, dependencyRecords);
        }

        const installingPacks = operations
          .filter((operation) => operation.action === 'install' && operation.pack)
          .flatMap((operation) => operation.harnesses.map((harness) => ({
            resource: operation.resource,
            version: operation.pack?.version ?? operation.version ?? 'unknown',
            harness,
            resources: operation.pack?.resources ?? [],
            installedAt: new Date().toISOString(),
          })));
        if (installingPacks.length > 0) {
          await updateInstallationPackRecords(manifestPath, installingPacks);
        }

        if (removingResourceIds.length > 0) {
          if (options.removeDependencies && plan.dependencyRemovals.length > 0) {
            removedDependencies = await uninstallToolDependencies(
              plan.dependencyRemovals,
              dependencyOptions,
            );
          }
          await removeToolDependencyRecords(manifestPath, removingResourceIds);
        }

        const removingPacks = operations
          .filter((operation) => operation.action === 'uninstall' && operation.pack)
          .flatMap((operation) => operation.harnesses.map((harness) => ({
            resource: operation.resource,
            harness,
          })));
        if (removingPacks.length > 0) {
          await removeInstallationPackRecords(manifestPath, removingPacks);
        }

        return {
          plan,
          installed,
          removed,
          warnings: [...new Set(warnings)],
          dependencies,
          removedDependencies,
          dependencyRemovals: plan.dependencyRemovals,
        };
      } catch (error) {
        const rollbackErrors: string[] = [];

        try {
          const candidates = toolDependencyRemovalCandidatesForInstallResults(dependencies);
          if (candidates.length > 0) {
            await uninstallToolDependencies(candidates, dependencyOptions);
          }
        } catch (rollbackError) {
          rollbackErrors.push(`Dependency rollback failed: ${errorMessage(rollbackError)}`);
        }

        if (removedDependencies.length > 0) {
          try {
            await restoreToolDependencies(removedDependencies, dependencyOptions);
          } catch (rollbackError) {
            rollbackErrors.push(`Dependency restoration failed: ${errorMessage(rollbackError)}`);
          }
        }

        if (rollbackErrors.length > 0) {
          throw new Error(
            `${errorMessage(error)} ${rollbackErrors.join(' ')}`,
            { cause: error },
          );
        }
        throw error;
      }
    },
    'Installation failed',
  );
}

export async function applyChangePlanEnvelope<T, P extends { fingerprint: string; conflicts: string[] }>(
  operations: readonly unknown[],
  options: ResourceChangeOptions,
  force: boolean,
  planned: P | undefined,
  planOperations: () => Promise<P>,
  pathsFor: (plan: P) => string[],
  applyAction: (plan: P) => Promise<T>,
  rollbackPrefix: string,
): Promise<T> {
  return withInstallationLocks(operations, options, async () => {
    const plan = planned ?? await planOperations();
    if (planned) {
      const fingerprint = await fingerprintPaths(pathsFor(plan));
      if (fingerprint !== plan.fingerprint) {
        throw new Error('Change plan is outdated. Generate a new preview before applying.');
      }
    }
    if (plan.conflicts.length > 0 && !force) {
      throw new Error(`Change plan contains conflicts: ${plan.conflicts.join(' ')}`);
    }

    const snapshots = await snapshotFiles(pathsFor(plan));

    try {
      return await applyAction(plan);
    } catch (error) {
      try {
        await restoreFiles(snapshots);
      } catch (rollbackError) {
        throw new Error(
          `${rollbackPrefix}. Rollback failed; manual review may be required.\nRollback error: ${errorMessage(rollbackError)}\nOriginal error: ${errorMessage(error)}`,
          { cause: error },
        );
      }
      throw new Error(
        `${rollbackPrefix}. All changes were rolled back.\nCause: ${errorMessage(error)}`,
        { cause: error },
      );
    }
  });
}

export async function removeStaleInstallationFiles(
  previous: InstallationRecord[],
  currentFiles: string[],
  options?: InstallOptions,
): Promise<void> {
  const keep = new Set(currentFiles);

  for (const record of previous) {
    const files = await ownedInstallationFiles(record, options);
    const stale = files.filter((path) => !keep.has(path));

    if (stale.length === 0) continue;

    const staleRecord: InstallationRecord = {
      ...record,
      files: stale,
    };
    if (record.fileHashes) {
      staleRecord.fileHashes = selectHashes(stale, record.fileHashes);
    }

    await assertInstallationFilesUnchanged(staleRecord, options?.force ?? false);
    await Promise.all(stale.map((path) => rm(path, { force: true })));
    await removeEmptyInstallationDirectories(staleRecord, stale);
  }
}

async function removeEmptyInstallationDirectories(
  record: InstallationRecord,
  files: string[],
): Promise<void> {
  const destination = resolve(record.destination);
  const roots = new Set<string>();

  if (files.some((path) => isPathWithin(resolve(path), destination) && resolve(path) !== destination)) {
    roots.add(destination);
  }

  for (const path of files) {
    let current = dirname(resolve(path));
    while (current !== dirname(current)) {
      if (basename(current).endsWith('.files')) {
        roots.add(current);
        break;
      }
      current = dirname(current);
    }
  }

  for (const root of roots) {
    for (const path of files) {
      const resolvedPath = resolve(path);
      if (!isPathWithin(resolvedPath, root) || resolvedPath === root) continue;

      let current = dirname(resolvedPath);
      while (isPathWithin(current, root)) {
        try {
          await rmdir(current);
        } catch (error) {
          if (isMissingPathError(error)) break;
          const code = error instanceof Error && 'code' in error
            ? error.code
            : undefined;
          if (code === 'ENOTEMPTY' || code === 'EEXIST') break;
          throw error;
        }
        if (current === root) break;
        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
      }
    }
  }
}

function isPathWithin(path: string, root: string): boolean {
  const pathRelativeToRoot = relative(root, path);
  return pathRelativeToRoot === ''
    || (!isAbsolute(pathRelativeToRoot)
      && pathRelativeToRoot !== '..'
      && !pathRelativeToRoot.startsWith('..' + sep));
}

function pathsOverlap(left: string, right: string): boolean {
  const first = resolve(left);
  const second = resolve(right);
  return isPathWithin(first, second) || isPathWithin(second, first);
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
    const installOptions = options ?? {};
    const root = openCodeInstallRoot(installOptions);
    const configPath = await openCodeConfigPath(root, installOptions);
    files.delete(configPath);
  }

  return [...files];
}

async function removeSharedConfiguration(
  record: InstallationRecord,
  options: InstallOptions,
): Promise<InstallChange[]> {
  const type = resourceType(record.resource);

  if (isPluginBundleType(type) && record.harness === 'codex') {
    const change = await removeCodexMarketplaceEntry(record, options);
    return change ? [change] : [];
  }

  if (type !== 'rules') return [];

  if (record.harness === 'opencode') {
    const change = await removeOpenCodeInstruction(record, options);
    return change ? [change] : [];
  } else if (record.harness === 'codex') {
    const change = await removeCodexGuidance(record, options);
    return change ? [change] : [];
  }

  return [];
}

function readOpenCodeInstructions(current: string, path: string): string[] | undefined {
  const errors: Array<{ error: number; offset: number; length: number }> = [];
  const data = parse(current, errors);

  if (errors.length > 0) {
    throw new Error(`OpenCode config is not a valid object: ${path}`);
  }

  const result = openCodeConfigSchema.safeParse(data);

  if (!result.success) {
    const issue = result.error.issues[0];
    if (issue?.path[0] === 'instructions') {
      throw new Error(`OpenCode config instructions must be an array of strings: ${path}`);
    }
    throw new Error(`OpenCode config is not a valid object: ${path}`);
  }

  return result.data.instructions;
}

function isEmptyOpenCodeConfig(current: string): boolean {
  const errors: Array<{ error: number; offset: number; length: number }> = [];
  const data = parse(current, errors);
  if (errors.length > 0 || data === null || typeof data !== 'object' || Array.isArray(data)) {
    return false;
  }

  const keys = Object.keys(data);
  return keys.every((key) => key === 'instructions')
    && Array.isArray((data as { instructions?: unknown }).instructions)
    && (data as { instructions: unknown[] }).instructions.length === 0;
}

async function removeOpenCodeInstruction(
  record: InstallationRecord,
  options: InstallOptions,
): Promise<InstallChange | null> {
  const root = openCodeInstallRoot(options);
  const path = await openCodeConfigPath(root, options);
  const current = await currentFile(path);

  if (current === null) return null;

  const currentInstructions = readOpenCodeInstructions(current, path);
  if (!currentInstructions) return null;

  const entry = toPosixPath(relative(dirname(path), record.destination));
  if (!currentInstructions.includes(entry)) return null;

  const ownership = record.shared?.find((item) => item.path === path && item.key === record.resource);
  if (record.shared && !ownership) return null;

  const content = applyEdits(
    current,
    modify(
      current,
      ['instructions'],
      currentInstructions.filter((value) => value !== entry),
      { formattingOptions: { insertSpaces: true, tabSize: 2 } },
    ),
  );

  return {
    path,
    content: ownership?.created && isEmptyOpenCodeConfig(content) ? null : content,
  };
}

async function removeCodexGuidance(
  record: InstallationRecord,
  options: InstallOptions,
): Promise<InstallChange | null> {
  const current = await currentFile(record.destination);

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

  const ownership = record.shared?.find((item) => item.path === record.destination && item.key === key);
  if (record.shared && !ownership) return null;

  const block = current.slice(start, end + endMarker.length);
  if (ownership && hashContent(block) !== ownership.hash && !options.force) {
    throw new Error(`Codex managed rule block was modified: ${key}. Use --force to continue.`);
  }

  const before = current.slice(0, start);
  const after = current.slice(end + endMarker.length);
  const cleanedBefore = before.endsWith('\n\n') ? before.slice(0, -1) : before;
  const cleanedAfter = after.startsWith('\n') ? after.slice(1) : after;
  const content = `${cleanedBefore}${cleanedAfter}`;
  return {
    path: record.destination,
    content: ownership?.created && content.trim() === '' ? null : content,
  };
}

export function resourceType(resource: string): ResourceKind | undefined {
  const type = resource.split('/')[1];
  return type === 'skills' || type === 'agents' || type === 'rules' || type === 'plugins' || type === 'tools'
    ? type
    : undefined;
}

function isPluginBundle(resource: ResourceVersion): boolean {
  return isPluginBundleType(resource.resource.type);
}

function isPluginBundleType(
  type: ResourceVersion['resource']['type'] | undefined,
): type is 'plugins' | 'tools' {
  return type === 'plugins' || type === 'tools';
}

function installationKey(record: Pick<InstallationRecord, 'resource' | 'harness'>): string {
  return `${record.harness}:${record.resource}`;
}

function fullyRemovedResourceIds(
  operations: ResourceOperation[],
  installations: InstallationRecord[],
): string[] {
  const removedOwners = new Map<string, Set<string>>();
  for (const operation of operations.filter((item) => item.action === 'uninstall')) {
    const resourceIds = operation.resourceIds
      ?? operation.resources?.map((resource) => resourceKey(resource.resource))
      ?? [];
    for (const harness of operation.harnesses) {
      for (const resource of resourceIds) {
        const key = `${harness}:${resource}`;
        const owners = removedOwners.get(key) ?? new Set<string>();
        owners.add(operation.pack ? operation.resource : resource);
        removedOwners.set(key, owners);
      }
    }
  }

  const installedResourceIds = new Set(
    installations
      .filter((record) => {
        const owners = removedOwners.get(installationKey(record));
        return owners === undefined || installationOwners(record).some((owner) => !owners.has(owner));
      })
      .map((record) => record.resource),
  );
  const installingResourceIds = new Set(
    operations
      .filter((operation) => operation.action === 'install')
      .flatMap((operation) =>
        operation.resources?.map((resource) => resourceKey(resource.resource)) ?? [],
      ),
  );

  return [...new Set(
    operations
      .filter((operation) => operation.action === 'uninstall')
      .flatMap((operation) =>
        operation.resourceIds ?? operation.resources?.map((resource) => resourceKey(resource.resource)) ?? [],
      ),
  )].filter((resource) => !installedResourceIds.has(resource) && !installingResourceIds.has(resource));
}

const openCodeConfigSchema = z.object({
  instructions: z.array(z.string()).optional(),
});

type InstallPlan = {
  resource: ResourceVersion;
  destination: string;
  files: InstallFile[];
  skippedFiles: string[];
};

type InstallFile = {
  path: string;
  content: string;
  mode?: number;
  destination: string;
};

type PreparedText = {
  path: string;
  content: string;
  ownership?: SharedOwnership[];
};

type CodexInstallPaths = {
  root: string;
  codexHome: string;
  skillsRoot: string;
  guidanceRoot: string;
  marketplacePath: string;
};

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

    return {
      resource,
      destination,
      files: [{ ...moduleFile, destination }],
      skippedFiles: [],
    };
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

function createPluginPlan(
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

function openCodePluginModule(resource: ResourceVersion): ResourceFile | undefined {
  return resource.files.find((file) => file.path === '.opencode/plugin.ts')
    ?? resource.files.find((file) => file.path === '.opencode/plugin.js');
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

function toolExecutablePaths(resource: ResourceVersion): readonly string[] {
  return resource.resource.type === 'tools' ? readToolManifest(resource).executables : [];
}

function withExecutableMode(file: InstallFile, executable: boolean): InstallFile {
  if (executable) file.mode = 0o755;
  return file;
}

function projectFiles(resource: ResourceVersion, harness: Harness) {
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
  return resolveHarnessPaths('claude-code', options).config;
}

function openCodeInstallRoot(options: InstallOptions): string {
  return resolveHarnessPaths('opencode', options).root;
}

function codexInstallPaths(options: InstallOptions): CodexInstallPaths {
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

function resourceDestination(root: string, resource: ResourceVersion): string {
  if (resource.resource.type === 'skills') {
    return join(root, 'skills', resource.resource.name);
  }

  return join(root, resource.resource.type, `${resource.resource.name}.md`);
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
  resources: ResourceVersion[],
  options: InstallOptions,
): Promise<PreparedText> {
  const path = await openCodeConfigPath(root, options);
  const entries = resources.map((resource) =>
    ({
      resource: resourceKey(resource.resource),
      entry: toPosixPath(relative(
        dirname(path),
        resourceDestination(root, resource),
      )),
    }),
  );
  const current = await currentFile(path);

  const currentInstructions = current === null ? undefined : readOpenCodeInstructions(current, path);

  const instructions = currentInstructions === undefined
    ? []
    : [...currentInstructions];

  const ownership = entries.flatMap(({ resource, entry }) => {
    if (instructions.includes(entry)) return [];
    instructions.push(entry);
    return [{
      path,
      key: resource,
      hash: hashContent(entry),
      created: current === null,
    }];
  });

  if (current === null) {
    return {
      path,
      content: `${JSON.stringify({ instructions }, null, 2)}\n`,
      ownership,
    };
  }

  return {
    path,
    content: applyEdits(
      current,
      modify(current, ['instructions'], instructions, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      }),
    ),
    ownership,
  };
}

export async function pickOpenCodeConfig(candidates: string[]): Promise<string> {
  for (const path of candidates) {
    if (await pathExists(path)) {
      return path;
    }
  }

  return candidates[candidates.length - 1] ?? '';
}

async function openCodeConfigPath(
  root: string,
  options: InstallOptions,
): Promise<string> {
  const customPath = configuredPath(options.environment ?? process.env, 'OPENCODE_CONFIG');

  if (customPath) {
    return customPath;
  }

  return pickOpenCodeConfig([join(root, 'opencode.jsonc'), join(root, 'opencode.json')]);
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
  const startMarker = `<!-- ai-directory:rule:${key} -->`;
  const endMarker = `<!-- /ai-directory:rule:${key} -->`;
  const start = contents.indexOf(startMarker);
  const end = contents.indexOf(endMarker);

  if ((start === -1) !== (end === -1) || (start !== -1 && end < start)) {
    throw new Error(`Codex managed rule block is malformed: ${key}`);
  }

  const block = codexRuleBlock(resource);

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

function codexRuleBlock(resource: ResourceVersion): string {
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

const marketplacePluginSchema = z
  .object({
    name: z.string().min(1),
    source: z
      .object({
        source: z.string().min(1),
        path: z.string().min(1),
      })
      .passthrough(),
    policy: z
      .object({
        installation: z.string().min(1),
        authentication: z.string().min(1),
      })
      .passthrough(),
    category: z.string().min(1),
  })
  .passthrough();

const marketplaceSchema = z
  .object({
    name: z.string().optional(),
    plugins: z.array(marketplacePluginSchema).optional(),
  })
  .passthrough();

type MarketplaceData = z.infer<typeof marketplaceSchema>;
type MarketplacePlugin = z.infer<typeof marketplacePluginSchema>;
type MarketplaceRemoval = {
  content: string;
  changed: boolean;
};

function marketplacePluginEntry(name: string): MarketplacePlugin {
  return {
    name,
    source: { source: 'local', path: `../.codex/plugins/${name}` },
    policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
    category: 'AI Directory',
  };
}

async function prepareCodexMarketplace(
  paths: CodexInstallPaths,
  plans: InstallPlan[],
  force: boolean,
): Promise<PreparedText> {
  const current = await currentFile(paths.marketplacePath);
  const data = current?.trim() ? parseMarketplace(current, paths.marketplacePath) : {};
  const plugins = [...(data.plugins ?? [])];
  const requestedNames = new Set<string>();
  const ownership: SharedOwnership[] = [];

  for (const plan of plans) {
    const name = plan.resource.resource.name;
    if (requestedNames.has(name)) {
      throw new Error(`Codex plugin names overlap in this installation: ${name}.`);
    }
    requestedNames.add(name);

    const existing = plugins.findIndex((plugin) => plugin.name === name);

    if (existing !== -1) {
      const existingSource = plugins[existing]?.source;
      const expectedSource = marketplacePluginEntry(name).source;
      if (
        existingSource?.source !== expectedSource.source
        || existingSource.path !== expectedSource.path
      ) {
        throw new Error(
          `Codex marketplace name is already used by another source: ${name}.`,
        );
      }
      if (!force) {
        throw new Error(
          `Codex plugin is already registered in the marketplace: ${name}. Use --force to overwrite.`,
        );
      }
    }

    const entry = marketplacePluginEntry(name);
    ownership.push({
      path: paths.marketplacePath,
      key: resourceKey(plan.resource.resource),
      hash: hashContent(JSON.stringify(entry)),
      created: current === null,
    });
    if (existing !== -1) plugins[existing] = entry;
    else plugins.push(entry);
  }

  return {
    path: paths.marketplacePath,
    content: `${JSON.stringify({ name: data.name ?? 'ai-directory', plugins }, null, 2)}\n`,
    ownership,
  };
}

function parseMarketplace(content: string, path: string): MarketplaceData {
  if (!content.trim()) return {};
  const errors: Array<{ error: number; offset: number; length: number }> = [];
  const result = marketplaceSchema.safeParse(parse(content, errors));

  if (errors.length > 0 || !result.success) {
    throw new Error(`Codex marketplace is not a valid object: ${path}`);
  }

  return result.data;
}

function removeCodexMarketplacePlugin(
  content: string,
  name: string,
  path: string,
): MarketplaceRemoval {
  if (!content.trim()) return { content, changed: false };
  const data = parseMarketplace(content, path);

  if (!data.plugins) return { content, changed: false };

  const plugins = data.plugins.filter((plugin) => plugin.name !== name);
  if (plugins.length === data.plugins.length) return { content, changed: false };

  return {
    content: `${JSON.stringify({ ...data, plugins }, null, 2)}\n`,
    changed: true,
  };
}

async function removeCodexMarketplaceEntry(
  record: InstallationRecord,
  options: InstallOptions,
): Promise<InstallChange | null> {
  const paths = codexInstallPaths(options);
  const current = await currentFile(paths.marketplacePath);

  if (current === null) return null;

  const name = record.resource.split('/').at(-1) ?? record.resource;
  const ownership = record.shared?.find((item) => item.path === paths.marketplacePath && item.key === record.resource);
  if (record.shared && !ownership) return null;

  if (ownership) {
    const data = parseMarketplace(current, paths.marketplacePath);
    const existing = data.plugins?.find((plugin) => plugin.name === name);
    if (existing && hashContent(JSON.stringify(existing)) !== ownership.hash && !options.force) {
      throw new Error(`Codex marketplace entry was modified: ${name}. Use --force to continue.`);
    }
  }

  const removal = removeCodexMarketplacePlugin(current, name, paths.marketplacePath);

  if (!removal.changed) return null;

  if (ownership?.created) {
    const remaining = parseMarketplace(removal.content, paths.marketplacePath);
    const keys = Object.keys(remaining);
    if (
      keys.every((key) => key === 'name' || key === 'plugins')
      && (remaining.plugins?.length ?? 0) === 0
      && (remaining.name === undefined || remaining.name === 'ai-directory')
    ) {
      return { path: paths.marketplacePath, content: null };
    }
  }

  return { path: paths.marketplacePath, content: removal.content };
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

export function publicOperation(operation: {
  resource: string;
  harnesses: Harness[];
  action: 'install' | 'uninstall';
  version?: string;
  scope?: ConfigScope;
}): typeof operation {
  const result: typeof operation = {
    resource: operation.resource,
    harnesses: operation.harnesses,
    action: operation.action,
  };
  if (operation.version !== undefined) result.version = operation.version;
  if (operation.scope !== undefined) result.scope = operation.scope;

  return result;
}

function operationInstallOptions(
  options: ResourceChangeOptions,
  force: boolean,
  dryRun = false,
  installationOwner?: string,
): InstallOptions {
  const result: InstallOptions = { force, dryRun };
  if (options.cwd) result.cwd = options.cwd;
  if (options.homeDirectory) result.homeDirectory = options.homeDirectory;
  if (options.scope) result.scope = options.scope;
  if (options.environment) result.environment = options.environment;
  if (installationOwner) result.installationOwner = installationOwner;

  return result;
}

function dependencyOptionsFrom(options: ResourceChangeOptions): ToolDependencyOptions {
  const result: ToolDependencyOptions = {};
  if (options.cwd) result.cwd = options.cwd;
  if (options.environment) result.environment = options.environment;
  if (options.dependencyCommandRunner) result.commandRunner = options.dependencyCommandRunner;
  return result;
}

export type FileSnapshot = {
  path: string;
  content: string | null;
  existingDirectories?: string[];
};

export async function snapshotFiles(paths: string[]): Promise<FileSnapshot[]> {
  const snapshots: FileSnapshot[] = [];

  for (const path of new Set(paths)) {
    snapshots.push({
      path,
      content: await currentFile(path),
      existingDirectories: await existingDirectoryAncestors(path),
    });
  }

  return snapshots;
}

export async function restoreFiles(snapshots: FileSnapshot[]): Promise<void> {
  for (const snapshot of snapshots) {
    if (snapshot.content === null) {
      await rm(snapshot.path, { force: true });
    } else {
      await writeFileAtomic(snapshot.path, snapshot.content);
    }
  }

  const existingDirectories = new Set(
    snapshots.flatMap((snapshot) => snapshot.existingDirectories ?? []),
  );
  for (const snapshot of snapshots) {
    if (snapshot.content === null) {
      await removeEmptyRollbackDirectories(dirname(resolve(snapshot.path)), existingDirectories);
    }
  }
}

async function existingDirectoryAncestors(path: string): Promise<string[]> {
  const existing: string[] = [];
  let current = dirname(resolve(path));

  while (current !== dirname(current)) {
    try {
      if (!(await lstat(current)).isDirectory()) break;
      existing.push(current);
    } catch (error) {
      if (isMissingPathError(error)) {
        current = dirname(current);
        continue;
      }
      throw error;
    }
    current = dirname(current);
  }

  return existing;
}

async function removeEmptyRollbackDirectories(
  start: string,
  existingDirectories: Set<string>,
): Promise<void> {
  let current = resolve(start);

  while (current !== dirname(current) && !existingDirectories.has(current)) {
    try {
      await rmdir(current);
    } catch (error) {
      if (isMissingPathError(error)) {
        current = dirname(current);
        continue;
      }
      const code = error instanceof Error && 'code' in error
        ? error.code
        : undefined;
      if (code === 'ENOTEMPTY' || code === 'EEXIST' || code === 'ENOTDIR') break;
      throw error;
    }
    current = dirname(current);
  }
}

export async function currentFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
}

function previewContent(content: string | null): string | undefined {
  if (content === null) return undefined;
  const limit = 20_000;
  return content.length > limit ? `${content.slice(0, limit)}\n…` : content;
}

function classifyChange(
  before: string | null,
  after: string | null,
): PlannedResourceChange['action'] | null {
  if (after === null) return before === null ? null : 'removed';
  if (before === null) return 'added';
  return before === after ? null : 'modified';
}

export function requestWarnings(resources: ResourceVersion[]): string[] {
  return [...new Set(resources
    .filter((resource) => resource.resource.reviewStatus === 'unreviewed')
    .map((resource) => `${resourceKey(resource.resource)}@${resource.version}`))];
}

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function installationManifestPath(
  options: ResourceChangeOptions,
): string {
  return getScopeInstallManifestPath(
    options.scope ?? 'user',
    options.cwd,
    options.homeDirectory,
  );
}

function resourcePlanPaths(
  operations: ResourceOperation[],
  changes: PlannedResourceChange[],
  options: ResourceChangeOptions,
): string[] {
  return [
    ...changes.map((change) => change.path),
    ...operations.map(() => installationManifestPath(options)),
  ];
}

export async function fingerprintPaths(paths: string[]): Promise<string> {
  const state = [];

  for (const path of [...new Set(paths)].sort()) {
    state.push([path, await currentFile(path)] as const);
  }

  return createHash('sha256').update(JSON.stringify(state)).digest('hex');
}

type InstallationLock = {
  release(): Promise<void>;
};

type InstallationLockOwner = {
  pid: number;
  token: string;
};

const installationLockSchema = z.object({
  pid: z.number().int().positive(),
  token: z.string(),
});

export async function withInstallationLocks<T>(
  operations: readonly unknown[],
  options: ResourceChangeOptions,
  action: () => Promise<T>,
): Promise<T> {
  const lockPaths = [...new Set(
    operations.map(() =>
      `${resolve(installationManifestPath(options))}.lock`,
    ),
  )].sort();
  const locks: InstallationLock[] = [];

  let acquisitionError: unknown;
  try {
    for (const path of lockPaths) locks.push(await acquireInstallationLock(path));
  } catch (error) {
    acquisitionError = error;
  }

  if (acquisitionError !== undefined) {
    await releaseLocks(locks);
    throw acquisitionError;
  }

  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    const value = await action();
    outcome = { ok: true, value };
  } catch (error) {
    outcome = { ok: false, error };
  }

  const releaseError = await releaseLocks(locks);

  if (!outcome.ok) throw releaseError ?? outcome.error;
  if (releaseError) throw releaseError;
  return outcome.value;
}

async function releaseLocks(locks: InstallationLock[]): Promise<Error | undefined> {
  let releaseError: Error | undefined;
  for (const lock of locks.reverse()) {
    try {
      await lock.release();
    } catch (error) {
      releaseError ??= toError(error);
    }
  }
  return releaseError;
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

async function acquireInstallationLock(path: string): Promise<InstallationLock> {
  const existingDirectories = new Set(await existingDirectoryAncestors(path));
  await mkdir(dirname(path), { recursive: true });
  const owner = { pid: process.pid, token: randomUUID() } satisfies InstallationLockOwner;
  const content = `${JSON.stringify(owner)}\n`;

  while (true) {
    try {
      const handle = await open(path, 'wx');
      try {
        await handle.writeFile(content, 'utf8');
      } catch (error) {
        await rm(path, { force: true });
        throw error;
      } finally {
        await handle.close();
      }

      return {
        release: async () => {
          if (await currentFile(path) === content) {
            await rm(path, { force: true });
            await removeEmptyRollbackDirectories(dirname(resolve(path)), existingDirectories);
          }
        },
      };
    } catch (error) {
      if (!isPathExistsError(error)) throw error;

      const existing = await readInstallationLock(path);
      if (!existing && !(await pathExists(path))) continue;
      if (!existing || isProcessRunning(existing.pid)) {
        throw new Error(`Another AI Directory installation is in progress: ${path}`);
      }

      await rm(path, { force: true });
    }
  }
}

async function readInstallationLock(path: string): Promise<InstallationLockOwner | null> {
  let content: string;

  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }

  try {
    const result = installationLockSchema.safeParse(JSON.parse(content));
    if (result.success) return { pid: result.data.pid, token: result.data.token };
  } catch {
    return null;
  }

  return null;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

function toPosixPath(path: string): string {
  return path.split(sep).join('/');
}
