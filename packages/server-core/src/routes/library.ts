import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import {
  addResourceDirectory,
  getConfigPath,
  normalizeResourceDirectoryPath,
  pathExists,
  readConfigFile,
  readResourceDirectories,
  removeResourceDirectory,
  shortenHomePath,
  writeConfigFile,
} from '@ai-directory/config';
import { discoverLocalResources, enrichLocalResources, errorMessage } from '@ai-directory/installers';
import type { ExtraResourceDirectory, LocalResource, ResourceDiscoveryOptions } from '@ai-directory/installers';
import { jsonBody } from '../http.js';
import { localResourceFromMcpRecord, readInstallationRecords } from '../installations.js';
import { aggregatedRegistry } from '../planning.js';
import { resourceDirectorySchema } from '../requests.js';
import type { RouteContext } from '../types.js';

export function registerLibraryRoutes({ app, options, cwd }: RouteContext): void {
  app.get('/api/installed', async (context) => {
    const installations = await readInstallationRecords(options.homeDirectory, cwd);

    return context.json({ installations });
  });

  app.get('/api/resource-directories', (context) => {
    try {
      const directories = readResourceDirectories(cwd).map((entry) => ({
        ...entry,
        path: normalizeResourceDirectoryPath(entry.path, options.homeDirectory),
      }));
      return context.json({ directories });
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 500);
    }
  });

  app.post('/api/resource-directories', async (context) => {
    let body: unknown;
    try {
      body = await jsonBody(context);
    } catch {
      return context.json({ error: 'Request body must be valid JSON.' }, 400);
    }

    const parsed = resourceDirectorySchema.safeParse(body);
    if (!parsed.success) {
      return context.json({ error: 'path must be a non-empty string.' }, 400);
    }

    try {
      const normalized = normalizeResourceDirectoryPath(parsed.data.path, options.homeDirectory);
      let stats: Awaited<ReturnType<typeof stat>>;
      try {
        stats = await stat(normalized);
      } catch {
        return context.json({ error: `Directory does not exist: ${normalized}.` }, 400);
      }
      if (!stats.isDirectory()) {
        return context.json({ error: `Not a directory: ${normalized}.` }, 400);
      }
      const scope = parsed.data.scope ?? 'user';
      const { path: configPath } = await addResourceDirectory({ path: normalized }, scope, cwd);
      return context.json({
        directories: readResourceDirectories(cwd),
        savedScope: scope,
        configPath,
      });
    } catch (caught) {
      const message = errorMessage(caught);
      const status = /already configured/iu.test(message) ? 400 : 500;
      if (status === 500) console.error(message);
      return context.json({ error: message }, status);
    }
  });

  app.get('/api/browse-directories', async (context) => {
    const rawBase = context.req.query('base')?.trim();
    const home = options.homeDirectory ?? homedir();
    const base = rawBase
      ? normalizeResourceDirectoryPath(rawBase, options.homeDirectory)
      : home;
    try {
      // stat follows symlinks, so /tmp -> private/tmp and other aliased
      // folders browse fine. lstat would reject them as symlinks.
      const stats = await stat(base);
      if (!stats.isDirectory()) {
        return context.json({ error: `Not a directory: ${base}.` }, 400);
      }
    } catch {
      return context.json({ error: `Directory does not exist: ${base}.` }, 400);
    }
    try {
      const rawSearch = context.req.query('search')?.trim();
      if (rawSearch && rawSearch.length >= 2) {
        const { entries, truncated } = await searchDirectoryTree(base, home, rawSearch);
        const parent = dirname(base);
        return context.json({
          base,
          displayBase: shortenHomePath(base, home),
          parent: parent !== base ? parent : undefined,
          home,
          entries,
          truncated,
          search: rawSearch,
        });
      }
      const { entries, truncated } = await browseDirectoryTree(base, home);
      const parent = dirname(base);
      return context.json({
        base,
        displayBase: shortenHomePath(base, home),
        parent: parent !== base ? parent : undefined,
        home,
        entries,
        truncated,
      });
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 500);
    }
  });

  app.delete('/api/resource-directories', async (context) => {
    const path = context.req.query('path')?.trim();
    const scopeParam = context.req.query('scope');
    if (!path) return context.json({ error: 'path must be a non-empty string.' }, 400);
    if (scopeParam && scopeParam !== 'user' && scopeParam !== 'project') {
      return context.json({ error: 'scope must be user or project.' }, 400);
    }

    try {
      const normalized = normalizeResourceDirectoryPath(path, options.homeDirectory);
      const scope = scopeParam === 'user' || scopeParam === 'project' ? scopeParam : undefined;
      const result = await removeResourceDirectory(normalized, scope, cwd);
      if (!result.removed) return context.json({ error: `Resource directory is not configured: ${normalized}.` }, 404);
      return context.json({ directories: readResourceDirectories(cwd), clearedScopes: result.scopes });
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 500);
    }
  });

  app.get('/api/local-resources', async (context) => {
    try {
      const records = await readInstallationRecords(options.homeDirectory, cwd);
      const discoveryOptions: ResourceDiscoveryOptions = {
        cwd,
        records,
        resourceDirectories: extraDiscoveryDirectories(options.homeDirectory, cwd),
      };
      if (options.homeDirectory) discoveryOptions.homeDirectory = options.homeDirectory;
      if (options.environment) discoveryOptions.environment = options.environment;
      const resources = await discoverLocalResources(discoveryOptions);
      const mcpResources = records
        .filter((record) => record.kind === 'mcp')
        .map(localResourceFromMcpRecord);
      const merged = [...resources, ...mcpResources];

      let registryError: string | undefined;
      let enriched = merged;

      if (merged.some((resource) => resource.resource)) {
        try {
          const aggregated = await aggregatedRegistry(options, cwd);
          enriched = enrichLocalResources(merged, {
            schemaVersion: 1,
            resources: aggregated.entries.map((entry) => entry.primary.summary),
          });
          if (aggregated.errors.length > 0) {
            registryError = aggregated.errors.map((entry) => `${entry.registry.id}: ${entry.error}`).join('; ');
          }
        } catch (caught) {
          registryError = errorMessage(caught);
        }
      }

      interface LocalResourcesResponse {
        resources: LocalResource[];
        registryError?: string;
        homeDirectory?: string;
      }

      const response: LocalResourcesResponse = { resources: enriched };
      if (registryError) response.registryError = registryError;
      response.homeDirectory = options.homeDirectory ?? homedir();

      return context.json(response);
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 500);
    }
  });
}

function extraDiscoveryDirectories(homeDirectory: string | undefined, cwd: string): ExtraResourceDirectory[] {
  return readResourceDirectories(cwd).map((entry) => ({
    path: normalizeResourceDirectoryPath(entry.path, homeDirectory),
  }));
}

type BrowseEntry = {
  path: string;
  displayPath: string;
  name: string;
  resourceCount: number;
};

// Recursive search under base, breadth-first and bounded. The picker list
// only shows one level, so without this the field can never match folders
// nested deeper. Default depth 4 and 200 results keep it fast; dot folders
// and symlinks are skipped, permission errors just prune that branch.
const SEARCH_MAX_DEPTH = 4;
const SEARCH_MAX_RESULTS = 200;
const SEARCH_MAX_DIRS = 2000;

async function searchDirectoryTree(
  base: string,
  homeDirectory: string | undefined,
  query: string,
): Promise<{ entries: BrowseEntry[]; truncated: boolean }> {
  const needle = query.toLowerCase();
  const entries: BrowseEntry[] = [];
  let truncated = false;
  let visited = 0;
  const queue: Array<{ dir: string; depth: number }> = [{ dir: base, depth: 0 }];
  const seen = new Set<string>([base]);

  while (queue.length > 0 && entries.length < SEARCH_MAX_RESULTS && visited < SEARCH_MAX_DIRS) {
    const current = queue.shift();
    if (!current) break;
    visited += 1;
    let children: Array<{ name: string; path: string; isDirectory: boolean; isLink: boolean }>;
    try {
      const raw = await readdir(current.dir, { withFileTypes: true });
      children = raw.map((entry) => ({
        name: entry.name,
        path: joinDir(current.dir, entry.name),
        isDirectory: entry.isDirectory(),
        isLink: entry.isSymbolicLink(),
      }));
    } catch {
      continue;
    }

    for (const child of children) {
      if (!child.isDirectory || child.isLink || child.name.startsWith('.')) continue;
      if (seen.has(child.path)) continue;
      seen.add(child.path);
      // A match still gets descended into: the user may look for a parent
      // whose child also matches, and both should be offered.
      if (child.name.toLowerCase().includes(needle) || child.path.toLowerCase().includes(needle)) {
        entries.push({
          path: child.path,
          displayPath: shortenHomePath(child.path, homeDirectory),
          name: child.name,
          resourceCount: 0,
        });
        if (entries.length >= SEARCH_MAX_RESULTS) {
          truncated = true;
          break;
        }
      }
      if (current.depth + 1 <= SEARCH_MAX_DEPTH && visited + queue.length < SEARCH_MAX_DIRS) {
        queue.push({ dir: child.path, depth: current.depth + 1 });
      }
    }
  }
  if ((queue.length > 0 || visited >= SEARCH_MAX_DIRS) && entries.length >= SEARCH_MAX_RESULTS) {
    truncated = true;
  }

  return { entries, truncated };
}

// Lists one level of subfolders under base. Each entry carries a cheap
// structural probe count (no full discovery, no recursion) so the picker
// stays fast. Users drill in via the base breadcrumb or by picking a row.
async function browseDirectoryTree(
  base: string,
  homeDirectory: string | undefined,
): Promise<{ entries: BrowseEntry[]; truncated: boolean }> {
  const entries: BrowseEntry[] = [];
  let truncated = false;
  let children: Array<{ name: string; path: string; isDirectory: boolean; isLink: boolean }>;
  try {
    const raw = await readdir(base, { withFileTypes: true });
    children = raw.map((entry) => ({
      name: entry.name,
      path: joinDir(base, entry.name),
      isDirectory: entry.isDirectory(),
      isLink: entry.isSymbolicLink(),
    }));
  } catch {
    return { entries, truncated };
  }

  const folders = children
    .filter((child) => child.isDirectory && !child.isLink && !child.name.startsWith('.'))
    .sort((left, right) => left.name.localeCompare(right.name));
  const limited = folders.slice(0, 200);
  truncated = folders.length > limited.length;

  limited.forEach((child) => {
    entries.push({
      path: child.path,
      displayPath: shortenHomePath(child.path, homeDirectory),
      name: child.name,
      resourceCount: 0,
    });
  });

  return { entries, truncated };
}

function joinDir(dir: string, name: string): string {
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;
}

export async function pruneMissingResourceDirectories(cwd: string): Promise<string[]> {
  const removed: string[] = [];
  for (const scope of ['project', 'user'] as const) {
    const configPath = getConfigPath(scope, cwd);
    const current = readConfigFile(configPath);
    const directories = current.resourceDirectories ?? [];
    if (directories.length === 0) continue;
    const next = [];
    for (const entry of directories) {
      if (await pathExists(normalizeResourceDirectoryPath(entry.path))) {
        next.push(entry);
        continue;
      }
      removed.push(normalizeResourceDirectoryPath(entry.path));
    }
    if (next.length !== directories.length) {
      await writeConfigFile(configPath, {
        ...current,
        resourceDirectories: next.length > 0 ? next : undefined,
      });
    }
  }
  return removed;
}
