import { readdir } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';
import { isMissingPathError, isUnreadablePathError, listFilesUnder, pathExists } from '@ai-directory/config';
import type { RegistryIndex } from '@ai-directory/contracts';
import { resourceKey } from '@ai-directory/contracts';
import { isResourceVersionOutdated } from '@ai-directory/registry';
import type { ResourceKind } from './adapters.js';
import { hashFile } from './hashing.js';
import type { InstallationRecord } from './installation-records.js';
import { resourceType } from './resources.js';
import { discoverMcpServers, resourceName } from './mcp.js';
import { pathsOverlap } from './paths.js';
import {
  getHarnessDefinitions,
  resolveHarnessPaths,
  type Harness,
  type HarnessLocation,
  type HarnessPathOptions,
} from './harnesses.js';

export type LocalResourceState = 'managed' | 'modified' | 'missing' | 'unmanaged';
export type LocalResourceRegistryState = 'current' | 'outdated' | 'unknown';

export type LocalResourceSource = 'harness' | 'custom';

export type LocalResource = {
  resource?: string;
  type: ResourceKind;
  name: string;
  harness: Harness;
  path: string;
  files: string[];
  state: LocalResourceState;
  registryState: LocalResourceRegistryState;
  source?: LocalResourceSource;
  sourcePath?: string;
  version?: string;
  latestVersion?: string;
  scope?: 'user' | 'project';
};

// Custom directories are path-only. Harness attribution is inferred from
// folder layout at scan time, never asked from the user.
export type ExtraResourceDirectory = {
  path: string;
};

export type ResourceDiscoveryOptions = HarnessPathOptions & {
  records?: readonly InstallationRecord[];
  resourceDirectories?: readonly ExtraResourceDirectory[];
};

export async function discoverLocalResources(
  options: ResourceDiscoveryOptions = {},
): Promise<LocalResource[]> {
  const records = options.records ?? [];
  const fileRecords = records.filter((record) => record.kind !== 'mcp');
  const managed = await Promise.all(fileRecords.map(localResourceFromRecord));
  const managedRecords = records.filter((record) => resourceType(record.resource));
  const discovered: LocalResource[] = [];

  for (const definition of getHarnessDefinitions()) {
    const location = resolveHarnessPaths(definition.harness, options);
    const candidates = await scanLocation(definition.harness, location);

    discovered.push(
      ...candidates.filter(
        (candidate) => !matchesManagedRecord(candidate, managedRecords),
      ),
    );
  }

  const extraDirectories = options.resourceDirectories ?? [];
  for (const directory of extraDirectories) {
    const limited = await scanCustomDirectory(directory.path, options);
    discovered.push(
      ...limited.filter(
        (candidate) => !matchesManagedRecord(candidate, managedRecords),
      ),
    );
  }

  const managedMcpRecords = records.filter((record) => record.kind === 'mcp');
  const discoveredMcpServers = await discoverMcpServers(options);
  for (const server of discoveredMcpServers) {
    if (managedMcpRecords.some((record) =>
      record.harness === server.harness
      && resourceName(record.resource) === server.server
      && resolve(record.destination) === resolve(server.path),
    )) {
      continue;
    }
    discovered.push({
      type: 'mcp-servers',
      name: server.server,
      harness: server.harness,
      path: server.path,
      files: [server.path],
      state: 'unmanaged',
      registryState: 'unknown',
      scope: server.scope,
    });
  }

  const deduped = new Map<string, LocalResource>();
  for (const resource of [...managed, ...discovered]) {
    const key = `${resource.harness}:${resource.path}`;
    const previous = deduped.get(key);
    if (!previous || (previous.source !== 'custom' && resource.source === 'custom')) {
      deduped.set(key, resource);
    }
  }

  return [...deduped.values()].sort((left, right) =>
    [left.type, left.name, left.harness, left.path]
      .join('\0')
      .localeCompare([right.type, right.name, right.harness, right.path].join('\0')),
  );
}

export function enrichLocalResources(
  resources: LocalResource[],
  index: RegistryIndex | null,
): LocalResource[] {
  return resources.map((resource) => {
    const summary = resource.resource && index?.resources.find(
      (candidate) => resourceKey(candidate) === resource.resource,
    );

    if (!summary || !resource.version) {
      return { ...resource, registryState: 'unknown' as const };
    }

    if (summary.latestVersion === resource.version) {
      return {
        ...resource,
        registryState: 'current' as const,
        latestVersion: summary.latestVersion,
      };
    }

    return {
      ...resource,
      registryState: isResourceVersionOutdated(resource.version, summary.latestVersion)
        ? 'outdated' as const
        : 'unknown' as const,
      latestVersion: summary.latestVersion,
    };
  });
}

async function localResourceFromRecord(record: InstallationRecord): Promise<LocalResource> {
  const type = resourceType(record.resource);
  if (!type) {
    throw new Error(`Unsupported installed resource type: ${record.resource}`);
  }

  const files = record.files.length > 0 ? record.files : [record.destination];
  let state: LocalResourceState = 'managed';

  for (const path of files) {
    if (!(await pathExists(path))) {
      state = 'missing';
      break;
    }

    const expected = record.fileHashes?.[path];
    if (expected && (await hashFile(path)) !== expected) state = 'modified';
  }

  return {
    resource: record.resource,
    type,
    name: resourceName(record.resource),
    harness: record.harness,
    path: record.destination,
    files,
    state,
    registryState: 'unknown',
    version: record.version,
  };
}

async function scanLocation(
  harness: Harness,
  location: HarnessLocation,
): Promise<LocalResource[]> {
  return [
    ...(await scanSkills(harness, location.skills)),
    ...(await scanFlatResources(harness, 'agents', location.agents, harness === 'codex' ? ['.toml', '.md'] : ['.md'])),
    ...(await scanFlatResources(harness, 'rules', location.rules, ['.md'])),
    ...(await scanBundles(harness, location)),
  ];
}

// Custom directory scan. Rules:
// - Direct shape: <root>/<skill-name>/SKILL.md and loose name.md files.
// - Nested shape: <root>/<group>/<skill-name>/SKILL.md, two levels only.
// - Reports are attached to every harness only when their layout cannot be
//   told apart; harness-shaped layouts (skills/, agents/, rules/, plugins/,
//   tools/, .claude-plugin/, .codex-plugin/) attribute to that harness.
// - The custom root itself is never reported, even if it looks like a skill.
const MAX_CUSTOM_DEPTH = 2;

async function scanCustomDirectory(
  root: string,
  options: ResourceDiscoveryOptions,
): Promise<LocalResource[]> {
  const normalized = resolve(root);
  if (!(await pathExists(normalized))) return [];
  const found = await scanCustomTree(normalized, normalized, 0, options);

  const seen = new Set<string>();
  return found.filter((resource) => {
    const key = `${resource.harness}:${resource.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function scanCustomTree(
  root: string,
  dir: string,
  depth: number,
  _options: ResourceDiscoveryOptions,
): Promise<LocalResource[]> {
  const resources: LocalResource[] = [];
  const harnessHits = await scanHarnessShapedDirectory(dir, root);
  resources.push(...harnessHits);
  resources.push(...(await scanDirectCustomResources(dir, root)));

  if (depth < MAX_CUSTOM_DEPTH) {
    for (const entry of await readDirectory(dir)) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const child = join(dir, entry.name);
      if (await looksLikeCustomResource(child, dir)) continue;
      resources.push(...(await scanCustomTree(root, child, depth + 1, _options)));
    }
  }

  return resources;
}

// Resources described directly by one folder: SKILL.md inside, a flat
// name.md file, or a plugin/tool bundle marker. The folder itself, not the
// parent, becomes the resource path.
async function scanDirectCustomResources(dir: string, root: string): Promise<LocalResource[]> {
  const out: LocalResource[] = [];
  const entries = await readDirectory(dir);

  const skillDirs: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const child = join(dir, entry.name);
    // One level only: a direct child holding SKILL.md is a skill. Anything
    // deeper belongs to the recursive walk, not to a listing here, so a
    // huge tree (home folder, repo root) can never stall the scan.
    let direct: string[];
    try {
      const raw = await readdir(child, { withFileTypes: true });
      direct = raw.filter((item) => item.isFile()).map((item) => item.name);
    } catch {
      continue;
    }
    if (direct.includes('SKILL.md')) skillDirs.push(child);
  }
  for (const child of skillDirs) {
    const files = await listFilesUnder(child).catch(() => [] as string[]);
    if (files.length === 0) continue;
    const name = basename(child);
    for (const harness of customCandidateHarnesses(dir, root)) {
      out.push({
        type: 'skills',
        name,
        harness,
        path: child,
        files,
        state: 'unmanaged',
        registryState: 'unknown',
        source: 'custom',
        sourcePath: root,
      });
    }
  }

  for (const entry of entries) {
    if (!entry.isFile() || extname(entry.name).toLowerCase() !== '.md') continue;
    const stem = basename(entry.name, extname(entry.name));
    if (stem.toLowerCase() === 'skill' || stem.toUpperCase() === 'SKILL') continue;
    const kinds = dir === root ? (['agents', 'rules'] as const) : (['skills', 'agents', 'rules'] as const);
    for (const kind of kinds) {
      if (kind === 'skills') {
        for (const harness of customCandidateHarnesses(dir, root)) {
          out.push({
            type: 'skills',
            name: stem,
            harness,
            path: join(dir, entry.name),
            files: [join(dir, entry.name)],
            state: 'unmanaged',
            registryState: 'unknown',
            source: 'custom',
            sourcePath: root,
          });
        }
        break;
      }
      const peer = await scanFlatResources('claude-code', kind, dir, [extname(entry.name)]);
      const match = peer.find((candidate) => candidate.path === join(dir, entry.name));
      if (!match) continue;
      for (const harness of customCandidateHarnesses(dir, root)) {
        out.push({
          ...match,
          harness,
          source: 'custom',
          sourcePath: root,
        });
      }
      break;
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const child = join(dir, entry.name);
    if (skillDirs.includes(child)) continue;
    // One level only, same reason as above: markers must sit directly in
    // the child folder, never somewhere deeper in its tree.
    let direct: string[];
    try {
      const raw = await readdir(child, { withFileTypes: true });
      direct = raw.filter((item) => item.isFile()).map((item) => item.name);
    } catch {
      continue;
    }
    const type = direct.includes('TOOL.md')
      ? 'tools'
      : direct.includes('plugin.json') && await hasPluginMarker(child)
        ? 'plugins'
        : undefined;
    if (!type) continue;
    const files = await listFilesUnder(child).catch(() => [] as string[]);
    if (files.length === 0) continue;
    for (const harness of customCandidateHarnesses(dir, root)) {
      out.push({
        type,
        name: entry.name,
        harness,
        path: child,
        files,
        state: 'unmanaged',
        registryState: 'unknown',
        source: 'custom',
        sourcePath: root,
      });
    }
  }

  return out;
}

async function hasPluginMarker(dir: string): Promise<boolean> {
  const candidates = [
    join(dir, '.claude-plugin', 'plugin.json'),
    join(dir, '.codex-plugin', 'plugin.json'),
  ];
  const checks = await Promise.all(candidates.map((path) => pathExists(path)));
  return checks.some(Boolean);
}

// A folder that already looks like a harness layout gets a single harness
// attribution: top-level skills/, agents/, rules/, plugins/, tools/, or a
// plugin marker directly inside the folder. Shallow checks only: a
// recursive listing here would walk the whole tree on every level.
async function scanHarnessShapedDirectory(dir: string, root: string): Promise<LocalResource[]> {
  const out: LocalResource[] = [];
  const entries = await readDirectory(dir);
  const names = new Set(entries.map((entry) => entry.name));
  const shaped = names.has('skills') || names.has('agents') || names.has('rules')
    || names.has('plugins') || names.has('tools')
    || await hasPluginMarker(dir);
  if (!shaped) return out;

  for (const harness of getHarnessDefinitions().map((definition) => definition.harness)) {
    const location = customLocationFor(harness, dir);
    if (names.has('skills')) out.push(...withSource(await scanSkills(harness, join(dir, 'skills')), root));
    if (names.has('agents')) {
      out.push(...withSource(
        await scanFlatResources(harness, 'agents', join(dir, 'agents'), harness === 'codex' ? ['.toml', '.md'] : ['.md']),
        root,
      ));
    }
    if (names.has('rules')) {
      out.push(...withSource(await scanFlatResources(harness, 'rules', join(dir, 'rules'), ['.md']), root));
    }
    out.push(...withSource(
      (await scanBundles(harness, location)).filter((candidate) => candidate.path.startsWith(dir)),
      root,
    ));
  }

  return out;
}

function customLocationFor(harness: Harness, dir: string): HarnessLocation {
  if (harness === 'codex') {
    return {
      root: dir,
      config: dir,
      skills: join(dir, 'skills'),
      agents: join(dir, 'agents'),
      rules: join(dir, 'rules'),
      guidance: dir,
    };
  }
  return {
    root: dir,
    config: dir,
    skills: join(dir, 'skills'),
    agents: join(dir, 'agents'),
    rules: join(dir, 'rules'),
    guidance: dir,
  };
}

// When a folder gives no harness signal, every harness can consume the
// files, so the resource is reported once per harness and the user picks
// the target at install time.
function customCandidateHarnesses(_dir: string, _root: string): Harness[] {
  return getHarnessDefinitions().map((definition) => definition.harness);
}

async function looksLikeCustomResource(dir: string, _parent: string): Promise<boolean> {
  // Direct children only. A recursive check here would re-walk every
  // subtree at every level and turn the whole scan quadratic.
  let direct: string[];
  try {
    const raw = await readdir(dir, { withFileTypes: true });
    direct = raw.filter((item) => item.isFile()).map((item) => item.name);
  } catch {
    return false;
  }
  if (direct.length === 0) return false;
  return direct.includes('SKILL.md')
    || direct.includes('TOOL.md')
    || direct.some((file) => file.toLowerCase().endsWith('.md'));
}

function withSource(resources: LocalResource[], root: string): LocalResource[] {
  return resources.map((resource) => ({
    ...resource,
    source: 'custom' as const,
    sourcePath: root,
  }));
}

async function scanBundles(
  harness: Harness,
  location: HarnessLocation,
): Promise<LocalResource[]> {
  if (harness !== 'opencode') {
    const root = harness === 'claude-code'
      ? location.skills
      : join(location.config, 'plugins');
    return scanBundleDirectories(harness, root);
  }

  const candidates = [
    ...(await scanOpenCodePluginFiles(location.root)),
    ...(await scanOpenCodeToolDirectories(location.root)),
  ];
  const merged = new Map<string, LocalResource>();
  for (const candidate of candidates) {
    const key = `${candidate.type}:${candidate.name}`;
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, candidate);
      continue;
    }
    previous.files = [...new Set([...previous.files, ...candidate.files])];
  }

  return [...merged.values()];
}

async function scanBundleDirectories(
  harness: Harness,
  root: string,
): Promise<LocalResource[]> {
  const entries = await readDirectory(root);
  const resources: LocalResource[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;

    const path = join(root, entry.name);
    const files = await listFilesUnder(path);
    const relativeFiles = files.map((file) => relative(path, file));
    const type = relativeFiles.includes('TOOL.md')
      ? 'tools'
      : relativeFiles.includes('.claude-plugin/plugin.json') || relativeFiles.includes('.codex-plugin/plugin.json')
        ? 'plugins'
        : undefined;
    if (!type) continue;

    resources.push({
      type,
      name: entry.name,
      harness,
      path,
      files,
      state: 'unmanaged',
      registryState: 'unknown',
    });
  }

  return resources;
}

async function scanOpenCodePluginFiles(root: string): Promise<LocalResource[]> {
  const pluginRoot = join(root, 'plugins');
  const entries = await readDirectory(pluginRoot);
  const resources: LocalResource[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !['.ts', '.js'].includes(extname(entry.name))) continue;

    const path = join(pluginRoot, entry.name);
    const name = basename(entry.name, extname(entry.name));
    const companionPath = join(pluginRoot, `${name}.files`);
    const companionFiles = (await pathExists(companionPath))
      ? await listFilesUnder(companionPath)
      : [];
    const files = [path, ...companionFiles];
    const type = companionFiles.some((file) => relative(companionPath, file) === 'TOOL.md')
      ? 'tools'
      : 'plugins';

    resources.push({
      type,
      name,
      harness: 'opencode',
      path,
      files,
      state: 'unmanaged',
      registryState: 'unknown',
    });
  }

  return resources;
}

async function scanOpenCodeToolDirectories(root: string): Promise<LocalResource[]> {
  const toolRoot = join(root, 'tools');
  const entries = await readDirectory(toolRoot);
  const resources: LocalResource[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;

    const path = join(toolRoot, entry.name);
    const companionPath = join(toolRoot, `${entry.name}.files`);
    const companionFiles = (await pathExists(companionPath))
      ? await listFilesUnder(companionPath)
      : [];
    if (!companionFiles.some((file) => relative(companionPath, file) === 'TOOL.md')) continue;

    resources.push({
      type: 'tools',
      name: entry.name,
      harness: 'opencode',
      path,
      files: [...(await listFilesUnder(path)), ...companionFiles],
      state: 'unmanaged',
      registryState: 'unknown',
    });
  }

  return resources;
}

async function scanSkills(
  harness: Harness,
  root: string,
): Promise<LocalResource[]> {
  const entries = await readDirectory(root);
  const resources: LocalResource[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;

    const path = join(root, entry.name);
    const files = await listFilesUnder(path);
    if (!files.some((file) => relative(path, file) === 'SKILL.md')) continue;

    resources.push({
      type: 'skills',
      name: entry.name,
      harness,
      path,
      files,
      state: 'unmanaged',
      registryState: 'unknown',
    });
  }

  return resources;
}

async function scanFlatResources(
  harness: Harness,
  type: Exclude<ResourceKind, 'skills'>,
  root: string,
  extensions: string[],
): Promise<LocalResource[]> {
  const entries = await readDirectory(root);
  const resources: LocalResource[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !extensions.includes(extname(entry.name))) continue;

    const path = join(root, entry.name);
    const name = basename(entry.name, extname(entry.name));
    const companionPath = join(root, `${name}.files`);
    const companionFiles = (await pathExists(companionPath))
      ? await listFilesUnder(companionPath)
      : [];
    const files = [path, ...companionFiles];

    resources.push({
      type,
      name,
      harness,
      path,
      files,
      state: 'unmanaged',
      registryState: 'unknown',
    });
  }

  return resources;
}

function matchesManagedRecord(
  candidate: LocalResource,
  records: readonly InstallationRecord[],
): boolean {
  return records.some((record) => {
    if (record.harness !== candidate.harness) return false;

    const managedPaths = [record.destination, ...record.files].map((path) => resolve(path));
    return candidate.files.some((file) =>
      managedPaths.some((managedPath) => pathsOverlap(file, managedPath)),
    );
  });
}

async function readDirectory(path: string) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    // A folder we cannot read (missing, or macOS privacy denying Desktop,
    // Documents, Downloads) contributes nothing to the scan. Throwing here
    // would fail the whole /api/local-resources request.
    if (isMissingPathError(error) || isUnreadablePathError(error)) return [];
    throw error;
  }
}
