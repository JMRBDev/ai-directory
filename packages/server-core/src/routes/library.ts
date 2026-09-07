import { homedir } from 'node:os';
import {
  addResourceDirectory,
  getConfigPath,
  normalizeResourceDirectoryPath,
  pathExists,
  readConfigFile,
  readResourceDirectories,
  removeResourceDirectory,
  writeConfigFile,
} from '@ai-directory/config';
import { discoverLocalResources, enrichLocalResources, errorMessage } from '@ai-directory/installers';
import type { ExtraResourceDirectory, LocalResource, ResourceDiscoveryOptions } from '@ai-directory/installers';
import { registrySource } from '../environment.js';
import { jsonBody } from '../http.js';
import { localResourceFromMcpRecord, readInstallationRecords } from '../installations.js';
import { cachedRegistry } from '../planning.js';
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
      const issue = parsed.error.issues[0];
      const field = issue?.path[issue.path.length - 1];
      if (field === 'path') return context.json({ error: 'path must be a non-empty string.' }, 400);
      if (field === 'harness') return context.json({ error: 'harness must include only claude-code, opencode, codex.' }, 400);
      if (field === 'type') return context.json({ error: 'type must be auto, skills, agents, rules, plugins, or tools.' }, 400);
      return context.json({ error: 'Request body must be a JSON object.' }, 400);
    }

    try {
      const normalized = normalizeResourceDirectoryPath(parsed.data.path, options.homeDirectory);
      if (!(await pathExists(normalized))) {
        return context.json({ error: `Directory does not exist: ${normalized}.` }, 400);
      }
      const scope = parsed.data.scope ?? 'user';
      const entry: { path: string; harness?: 'claude-code' | 'opencode' | 'codex'; type?: 'auto' | 'skills' | 'agents' | 'rules' | 'plugins' | 'tools' } = { path: normalized };
      if (parsed.data.harness) entry.harness = parsed.data.harness;
      if (parsed.data.type) entry.type = parsed.data.type;
      const { path: configPath } = await addResourceDirectory(entry, scope, cwd);
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
          const snapshot = await cachedRegistry.get(registrySource(options, cwd));
          enriched = enrichLocalResources(merged, await snapshot.readIndex());
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
  return readResourceDirectories(cwd).map((entry) => {
    const directory: ExtraResourceDirectory = {
      path: normalizeResourceDirectoryPath(entry.path, homeDirectory),
    };
    if (entry.harness) directory.harness = entry.harness;
    if (entry.type) directory.type = entry.type;
    return directory;
  });
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
