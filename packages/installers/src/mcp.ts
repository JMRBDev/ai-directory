import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { getScopeInstallManifestPath, writeFileAtomic, type ConfigScope } from '@ai-directory/config';
import { mcpEnvTokens, mcpEnvTokenPattern, type McpServerManifest } from '@ai-directory/contracts';
import { resourceKey } from '@ai-directory/contracts';
import { readMcpServerManifest, type ResourceVersion } from '@ai-directory/registry';
import { applyEdits, modify, parse } from 'jsonc-parser';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { z } from 'zod';
import { resolveHarnessPaths, type Harness } from './harnesses.js';
import {
  applyChangePlanEnvelope,
  currentFile,
  fingerprintPaths,
  hashContent,
  pickOpenCodeConfig,
  publicOperation,
  readInstallationManifest,
  removeInstallationRecord,
  requestWarnings,
  updateInstallationManifest,
  type InstallOptions,
  type InstallationRecord,
  type ResourceChangeOptions,
} from './index.js';

export type McpOperation = {
  resource: string;
  harnesses: Harness[];
  action: 'install' | 'uninstall';
  version?: string;
  resources?: ResourceVersion[];
  resourceIds?: string[];
  scope?: ConfigScope;
  warningResources?: ResourceVersion[];
};

export type McpChange = {
  path: string;
  action: 'added' | 'modified' | 'removed';
  resource: string;
  harness: Harness;
  server: string;
  before?: string;
  after?: string;
};

export type McpPlan = {
  operations: McpOperation[];
  changes: McpChange[];
  conflicts: string[];
  warnings: string[];
  envNotes: string[];
  projectionNotes: string[];
  fingerprint: string;
};

export type McpApplyResult = {
  plan: McpPlan;
  installed: InstallationRecord[];
  removed: InstallationRecord[];
  warnings: string[];
};

type StringMap = Record<string, string>;
type McpOauth = Record<string, string | number | string[]>;

export type McpServerEntry = {
  type?: 'local' | 'remote' | 'http' | 'sse' | 'ws';
  command?: string | string[];
  args?: string[];
  cwd?: string;
  url?: string;
  headers?: StringMap;
  environment?: StringMap;
  env?: StringMap;
  oauth?: McpOauth;
  env_vars?: string[];
  bearer_token_env_var?: string;
  http_headers?: StringMap;
  env_http_headers?: StringMap;
  auth?: 'oauth';
  scopes?: string[];
};

type McpEntryResult = {
  entry: McpServerEntry;
  notes: string[];
};

type CodexHeaders = {
  staticHeaders: StringMap;
  envHeaders: StringMap;
  bearerTokenVar: string | undefined;
};

type RemovalResult = {
  content: string;
  changed: boolean;
};

type SectionBlock = {
  start: number;
  end: number;
};

const jsonConfigSchema = z.object({
  mcpServers: z.record(z.string(), z.unknown()).optional(),
  mcp: z.record(z.string(), z.unknown()).optional(),
});
type JsonConfig = z.infer<typeof jsonConfigSchema>;

const tomlConfigSchema = z.object({
  mcp_servers: z.record(z.string(), z.unknown()).optional(),
});
type TomlConfig = z.infer<typeof tomlConfigSchema>;

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const reservedClaudeServers = new Set([
  'workspace',
  'claude-in-chrome',
  'computer-use',
  'Claude Preview',
  'Claude Browser',
]);

export async function planMcpOperations(
  operations: McpOperation[],
  options: ResourceChangeOptions = {},
  force = false,
): Promise<McpPlan> {
  const scope = operationScope(operations, options);
  const environment = { ...process.env, ...options.environment };
  const changes: McpChange[] = [];
  const conflicts: string[] = [];
  const warnings: string[] = [];
  const envNotes: string[] = [];
  const contents = new Map<string, string | null>();
  const manifestPath = getScopeInstallManifestPath(scope, options.cwd, options.homeDirectory);
  const manifest = await readInstallationManifest(manifestPath);

  for (const operation of operations) {
    warnings.push(...requestWarnings(operation.warningResources ?? []));

    for (const harness of operation.harnesses) {
      const path = await mcpConfigPath(harness, scope, options);
      let content = (await contentFor(path, contents)) ?? '';

      if (operation.action === 'install') {
        const resources = operation.resources ?? [];
        if (resources.length === 0) {
          throw new Error(`MCP install operation has no resources: ${operation.resource}.`);
        }

        for (const resource of resources) {
          const serverManifest = readMcpServerManifest(resource);
          const server = resource.resource.name;
          const resourceId = resourceKey(resource.resource);
          const record = manifest.installations.find(
            (item) => item.harness === harness && item.resource === resourceId,
          );

          validateServerName(harness, server);

          const result = mcpEntryFor(harness, serverManifest);
          warnings.push(...result.notes);

          const existing = readEntry(harness, content, path, server);
          content = upsertEntry(harness, content, path, server, result.entry);

          if (existing === undefined) {
            changes.push(change(resourceId, harness, server, path, 'added', undefined, result.entry));
          } else if (record?.fileHashes?.[path] === entryHash(existing)) {
            changes.push(change(resourceId, harness, server, path, 'modified', existing, result.entry));
          } else if (record?.fileHashes && !force) {
            conflicts.push(
              `MCP server ${server} was modified after installation (${path}). Use --force to overwrite.`,
            );
            changes.push(change(resourceId, harness, server, path, 'modified', existing, result.entry));
          } else if (!force) {
            conflicts.push(
              `MCP server ${server} already exists in ${path}. Use --force to overwrite.`,
            );
            changes.push(change(resourceId, harness, server, path, 'modified', existing, result.entry));
          } else {
            changes.push(change(resourceId, harness, server, path, 'modified', existing, result.entry));
          }

          envNotes.push(...envNotesFor(server, serverManifest, environment));
        }

        contents.set(path, content);
      } else {
        const resourceIds = operation.resourceIds ?? [];
        const records = manifest.installations.filter(
          (item) => item.harness === harness && resourceIds.includes(item.resource),
        );

        for (const record of records) {
          const server = resourceName(record.resource);
          const existing = readEntry(harness, content, path, server);

          if (existing === undefined) {
            conflicts.push(
              `MCP entry for ${server} is already absent from ${path}. Use --force to continue.`,
            );
            continue;
          }

          const expected = record.fileHashes?.[path];
          if (expected !== undefined && entryHash(existing) !== expected && !force) {
            conflicts.push(
              `MCP entry for ${server} in ${path} was modified. Use --force to continue.`,
            );
          }

          changes.push(change(record.resource, harness, server, path, 'removed', existing, undefined));
        }
      }
    }
  }

  const affectedPaths = [
    ...new Set([...changes.map((change) => change.path), manifestPath]),
  ];

  return {
    operations: operations.map(publicOperation),
    changes,
    conflicts: [...new Set(conflicts)],
    warnings: [...new Set(warnings)],
    envNotes: [...new Set(envNotes)],
    projectionNotes: [],
    fingerprint: await fingerprintPaths(affectedPaths),
  };
}

export async function applyMcpOperations(
  operations: McpOperation[],
  options: ResourceChangeOptions = {},
  force = false,
  planned?: McpPlan,
): Promise<McpApplyResult> {
  const scope = operationScope(operations, options);
  const scopedOptions: ResourceChangeOptions = { ...options, scope };
  const manifestPath = getScopeInstallManifestPath(scope, options.cwd, options.homeDirectory);

  return applyChangePlanEnvelope(
    operations,
    scopedOptions,
    force,
    planned,
    () => planMcpOperations(operations, scopedOptions, force),
    (plan) => [...new Set([...plan.changes.map((change) => change.path), manifestPath])],
    async (plan) => {
      const installed: InstallationRecord[] = [];
      const removed: InstallationRecord[] = [];

      for (const operation of operations) {
        for (const harness of operation.harnesses) {
          if (operation.action === 'install') {
            const resources = operation.resources ?? [];
            const path = await mcpConfigPath(harness, scope, options);
            let content = (await currentFile(path)) ?? '';
            const records: InstallationRecord[] = [];

            for (const resource of resources) {
              const serverManifest = readMcpServerManifest(resource);
              const server = resource.resource.name;
              const result = mcpEntryFor(harness, serverManifest);
              content = upsertEntry(harness, content, path, server, result.entry);
              const persisted = readEntry(harness, content, path, server);

              records.push({
                resource: resourceKey(resource.resource),
                version: resource.version,
                harness,
                destination: path,
                files: [path],
                fileHashes: { [path]: entryHash(persisted) },
                kind: 'mcp',
                scope,
                installedAt: new Date().toISOString(),
              });
            }

            await writeFileAtomic(path, content);
            await updateInstallationManifest(manifestPath, records);
            installed.push(...records);
          } else {
            const resourceIds = operation.resourceIds ?? [];
            const manifest = await readInstallationManifest(manifestPath);
            const records = manifest.installations.filter(
              (item) => item.harness === harness && resourceIds.includes(item.resource),
            );

            for (const record of records) {
              await assertMcpEntryUnchanged(record, force);
              const path = record.destination;
              const content = await currentFile(path);

              if (content !== null) {
                const removal = removeEntry(harness, content, path, resourceName(record.resource));
                if (removal.changed) await writeFileAtomic(path, removal.content);
              }

              await removeInstallationRecord(manifestPath, record);
              removed.push(record);
            }
          }
        }
      }

      return {
        plan,
        installed,
        removed,
        warnings: [...new Set([...plan.warnings, ...plan.envNotes])],
      };
    },
    'MCP installation failed',
  );
}

async function assertMcpEntryUnchanged(
  record: InstallationRecord,
  force: boolean,
): Promise<void> {
  if (force) return;

  const expected = record.fileHashes?.[record.destination];
  if (!expected) {
    throw new Error(
      `MCP installation ${record.resource} has no ownership hash. Reinstall it with --force before updating or uninstalling.`,
    );
  }

  const content = await currentFile(record.destination);
  if (content === null) return;

  const existing = readEntry(
    record.harness,
    content,
    record.destination,
    resourceName(record.resource),
  );
  if (existing !== undefined && entryHash(existing) !== expected) {
    throw new Error(
      `MCP entry for ${resourceName(record.resource)} was modified. Use --force to continue.`,
    );
  }
}

function operationScope(
  operations: McpOperation[],
  options: ResourceChangeOptions,
): ConfigScope {
  return options.scope ?? operations[0]?.scope ?? 'user';
}

const projectConfigPaths = {
  'claude-code': (cwd: string) => join(cwd, '.mcp.json'),
  opencode: async (cwd: string) =>
    pickOpenCodeConfig([join(cwd, 'opencode.jsonc'), join(cwd, 'opencode.json')]),
  codex: (cwd: string) => join(cwd, '.codex', 'config.toml'),
} satisfies Record<Harness, (root: string) => string | Promise<string>>;

const userConfigPaths = {
  'claude-code': (home: string) => join(home, '.claude.json'),
  opencode: async (home: string, options: InstallOptions) => {
    const root = resolveHarnessPaths('opencode', options).root;
    return pickOpenCodeConfig([join(root, 'opencode.jsonc'), join(root, 'opencode.json')]);
  },
  codex: (home: string, options: InstallOptions) =>
    join(resolveHarnessPaths('codex', options).config, 'config.toml'),
} satisfies Record<Harness, (home: string, options: InstallOptions) => string | Promise<string>>;

async function mcpConfigPath(
  harness: Harness,
  scope: ConfigScope,
  options: InstallOptions,
): Promise<string> {
  if (scope === 'project') {
    return projectConfigPaths[harness](resolve(options.cwd ?? process.cwd()));
  }

  return userConfigPaths[harness](resolve(options.homeDirectory ?? homedir()), options);
}

function containerKey(harness: Harness): 'mcp' | 'mcpServers' {
  return harness === 'claude-code' ? 'mcpServers' : 'mcp';
}

export type DiscoveredMcpServer = {
  harness: Harness;
  server: string;
  path: string;
};

export async function discoverMcpServers(
  options: InstallOptions = {},
): Promise<DiscoveredMcpServer[]> {
  const harnesses: Harness[] = ['claude-code', 'opencode', 'codex'];
  const results: DiscoveredMcpServer[] = [];

  for (const harness of harnesses) {
    const path = await mcpConfigPath(harness, 'user', options);
    const content = await currentFile(path);
    if (content === null) continue;

    for (const server of mcpServerNames(harness, content, path)) {
      results.push({ harness, server, path });
    }
  }

  return results;
}

function mcpServerNames(harness: Harness, content: string, path: string): string[] {
  try {
    if (harness === 'codex') {
      return Object.keys(readTomlConfig(content, path).mcp_servers ?? {});
    }
    return Object.keys(readJsonConfig(content, path)[containerKey(harness)] ?? {});
  } catch {
    return [];
  }
}

const mcpEntries = {
  'claude-code': (manifest: McpServerManifest): McpEntryResult => ({
    entry: claudeMcpEntry(manifest),
    notes: [],
  }),
  opencode: (manifest: McpServerManifest): McpEntryResult => ({
    entry: openCodeMcpEntry(manifest),
    notes: [],
  }),
  codex: codexMcpEntry,
} satisfies Record<Harness, (manifest: McpServerManifest) => McpEntryResult>;

function mcpEntryFor(harness: Harness, manifest: McpServerManifest): McpEntryResult {
  return mcpEntries[harness](manifest);
}

function claudeMcpEntry(manifest: McpServerManifest): McpServerEntry {
  if (manifest.transport === 'stdio') {
    if (!manifest.command) throw new Error(`MCP server ${manifest.name} has no command.`);
    const entry: McpServerEntry = { command: manifest.command };
    if (manifest.args && manifest.args.length > 0) entry.args = manifest.args;
    const env = stdioEnv(manifest, (name) => `\${${name}}`);
    if (Object.keys(env).length > 0) entry.env = env;
    return entry;
  }

  if (!manifest.url) throw new Error(`MCP server ${manifest.name} has no url.`);
  const entry: McpServerEntry = { type: manifest.transport, url: manifest.url };
  const headers = rewriteHeaders(manifest, (name) => `\${${name}}`);
  if (Object.keys(headers).length > 0) entry.headers = headers;
  if (manifest.oauth) {
    const oauth: McpOauth = {};
    if (manifest.oauth.clientId) oauth.clientId = manifest.oauth.clientId;
    if (manifest.oauth.scopes && manifest.oauth.scopes.length > 0) {
      oauth.scopes = manifest.oauth.scopes.join(' ');
    }
    if (manifest.oauth.callbackPort) oauth.callbackPort = manifest.oauth.callbackPort;
    entry.oauth = oauth;
  }
  return entry;
}

function openCodeMcpEntry(manifest: McpServerManifest): McpServerEntry {
  if (manifest.transport === 'stdio') {
    if (!manifest.command) throw new Error(`MCP server ${manifest.name} has no command.`);
    const entry: McpServerEntry = {
      type: 'local',
      command: [manifest.command, ...(manifest.args ?? [])],
    };
    const env = stdioEnv(manifest, (name) => `{env:${name}}`);
    if (Object.keys(env).length > 0) entry.environment = env;
    if (manifest.cwd) entry.cwd = manifest.cwd;
    return entry;
  }

  if (!manifest.url) throw new Error(`MCP server ${manifest.name} has no url.`);
  const entry: McpServerEntry = { type: 'remote', url: manifest.url };
  const headers = rewriteHeaders(manifest, (name) => `{env:${name}}`);
  if (Object.keys(headers).length > 0) entry.headers = headers;
  if (manifest.oauth) {
    const oauth: McpOauth = {};
    if (manifest.oauth.clientId) oauth.clientId = manifest.oauth.clientId;
    if (manifest.oauth.clientSecretVar) {
      oauth.clientSecret = `{env:${manifest.oauth.clientSecretVar}}`;
    }
    if (manifest.oauth.scopes && manifest.oauth.scopes.length > 0) {
      oauth.scope = manifest.oauth.scopes.join(' ');
    }
    entry.oauth = oauth;
  }
  return entry;
}

function codexMcpEntry(manifest: McpServerManifest): McpEntryResult {
  const notes: string[] = [];

  if (manifest.transport === 'stdio') {
    if (!manifest.command) throw new Error(`MCP server ${manifest.name} has no command.`);
    const entry: McpServerEntry = { command: manifest.command };
    if (manifest.args && manifest.args.length > 0) entry.args = manifest.args;
    const vars = (manifest.env ?? []).map((variable) => variable.name);
    if (vars.length > 0) entry.env_vars = vars;
    if (manifest.cwd) entry.cwd = manifest.cwd;
    return { entry, notes };
  }

  if (!manifest.url) throw new Error(`MCP server ${manifest.name} has no url.`);
  const entry: McpServerEntry = { url: manifest.url };
  const headers = codexHeaders(manifest, notes);
  if (headers.bearerTokenVar) entry.bearer_token_env_var = headers.bearerTokenVar;
  if (Object.keys(headers.staticHeaders).length > 0) entry.http_headers = headers.staticHeaders;
  if (Object.keys(headers.envHeaders).length > 0) entry.env_http_headers = headers.envHeaders;

  if (manifest.oauth) {
    entry.auth = 'oauth';
    if (manifest.oauth.scopes && manifest.oauth.scopes.length > 0) {
      entry.scopes = manifest.oauth.scopes;
    }
  }

  return { entry, notes };
}

function codexHeaders(manifest: McpServerManifest, notes: string[]): CodexHeaders {
  const staticHeaders: StringMap = {};
  const envHeaders: StringMap = {};
  let bearerTokenVar: string | undefined;

  for (const [header, value] of Object.entries(manifest.headers ?? {})) {
    const tokens = mcpEnvTokens(value);

    if (tokens.length === 0) {
      staticHeaders[header] = value;
    } else if (
      header === 'Authorization' &&
      tokens.length === 1 &&
      value === `Bearer {env:${tokens[0]}}`
    ) {
      bearerTokenVar ??= tokens[0];
    } else if (tokens.length === 1 && value === `{env:${tokens[0]}}`) {
      const token = tokens[0];
      if (token !== undefined) envHeaders[header] = token;
    } else {
      notes.push(
        `Codex cannot express the ${header} header value for ${manifest.name}; set the full value in a single environment variable and reference it as {env:NAME}.`,
      );
    }
  }

  return { staticHeaders, envHeaders, bearerTokenVar };
}

function stdioEnv(manifest: McpServerManifest, format: (name: string) => string) {
  const env: StringMap = {};
  for (const variable of manifest.env ?? []) {
    env[variable.name] = format(variable.name);
  }
  return env;
}

function rewriteHeaders(manifest: McpServerManifest, format: (name: string) => string) {
  const headers: StringMap = {};
  for (const [name, value] of Object.entries(manifest.headers ?? {})) {
    headers[name] = rewriteEnvTokens(value, format);
  }
  return headers;
}

function rewriteEnvTokens(value: string, format: (name: string) => string): string {
  return value.replace(mcpEnvTokenPattern, (_, name: string) => format(name));
}

function validateServerName(harness: Harness, server: string): void {
  if (harness === 'claude-code' && reservedClaudeServers.has(server)) {
    throw new Error(`MCP server name "${server}" is reserved by Claude Code.`);
  }
}

function requiredEnvVars(manifest: McpServerManifest): string[] {
  const names = new Set<string>();

  if (manifest.transport === 'stdio') {
    for (const variable of manifest.env ?? []) {
      if (variable.required !== false) names.add(variable.name);
    }
    return [...names];
  }

  const optional = new Set(
    (manifest.env ?? [])
      .filter((variable) => variable.required === false)
      .map((variable) => variable.name),
  );
  for (const value of Object.values(manifest.headers ?? {})) {
    for (const token of mcpEnvTokens(value)) {
      if (!optional.has(token)) names.add(token);
    }
  }
  if (manifest.oauth?.clientSecretVar) names.add(manifest.oauth.clientSecretVar);
  return [...names];
}

function envNotesFor(
  server: string,
  manifest: McpServerManifest,
  environment: NodeJS.ProcessEnv,
): string[] {
  const declared = new Map(
    (manifest.env ?? []).map((variable) => [variable.name, variable.description]),
  );

  return requiredEnvVars(manifest)
    .filter((name) => !environment[name]?.trim())
    .map((name) => {
      const hint = declared.get(name);
      return `MCP ${server} needs the environment variable ${name}${hint ? ` (${hint})` : ''}. Set it in your shell before using the server, for example: export ${name}=...`;
    });
}

function change(
  resource: string,
  harness: Harness,
  server: string,
  path: string,
  action: McpChange['action'],
  before: JsonValue | undefined,
  after: McpServerEntry | undefined,
): McpChange {
  const result: McpChange = { path, action, resource, harness, server };
  const beforePreview = previewValue(before);
  const afterPreview = previewValue(after);
  if (beforePreview !== undefined) result.before = beforePreview;
  if (afterPreview !== undefined) result.after = afterPreview;
  return result;
}

function previewValue(value: JsonValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  const serialized = JSON.stringify(value, null, 2);
  return serialized === undefined ? undefined : serialized;
}

function entryHash(entry: JsonValue | undefined): string {
  return hashContent(JSON.stringify(entry ?? null));
}

export function resourceName(resource: string): string {
  return resource.split('/').at(-1) ?? resource;
}

async function contentFor(
  path: string,
  contents: Map<string, string | null>,
): Promise<string | null> {
  if (contents.has(path)) return contents.get(path) ?? null;
  const value = await currentFile(path);
  contents.set(path, value);
  return value;
}

function upsertEntry(
  harness: Harness,
  content: string,
  path: string,
  server: string,
  entry: McpServerEntry,
): string {
  return harness === 'codex'
    ? upsertTomlBlock(content, server, entry)
    : upsertJsonEntry(content, containerKey(harness), server, entry, path);
}

function readEntry(
  harness: Harness,
  content: string,
  path: string,
  server: string,
): JsonValue | undefined {
  return harness === 'codex'
    ? readTomlEntry(content, server)
    : readJsonEntry(content, containerKey(harness), server, path);
}

function removeEntry(
  harness: Harness,
  content: string,
  path: string,
  server: string,
): RemovalResult {
  return harness === 'codex'
    ? removeTomlBlock(content, server)
    : removeJsonEntry(content, containerKey(harness), server, path);
}

function readJsonConfig(content: string, path: string): JsonConfig {
  if (!content.trim()) return {};

  const errors: Array<{ error: number; offset: number; length: number }> = [];
  const data = parse(content, errors);

  if (errors.length > 0) {
    throw new Error(`MCP config is not valid JSON: ${path}`);
  }

  const result = jsonConfigSchema.safeParse(data);
  if (!result.success) {
    throw new Error(`MCP config is not a valid object: ${path}`);
  }
  return result.data;
}

function upsertJsonEntry(
  content: string,
  containerKey: 'mcp' | 'mcpServers',
  name: string,
  entry: McpServerEntry,
  path: string,
): string {
  const base = content.trim() ? content : '{}';
  const config = readJsonConfig(base, path);
  const servers = { ...config[containerKey], [name]: entry };

  return applyEdits(
    base,
    modify(base, [containerKey], servers, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    }),
  );
}

function removeJsonEntry(
  content: string,
  containerKey: 'mcp' | 'mcpServers',
  name: string,
  path: string,
): RemovalResult {
  const config = readJsonConfig(content, path);
  const servers = config[containerKey];
  if (servers === undefined || !(name in servers)) return { content, changed: false };

  const next = { ...servers };
  delete next[name];

  return {
    content: applyEdits(
      content,
      modify(content, [containerKey], next, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      }),
    ),
    changed: true,
  };
}

function readJsonEntry(
  content: string,
  containerKey: 'mcp' | 'mcpServers',
  name: string,
  path: string,
): JsonValue | undefined {
  const config = readJsonConfig(content, path);
  const servers = config[containerKey];
  if (servers === undefined) return undefined;

  const result = jsonValueSchema.safeParse(servers[name]);
  return result.success ? result.data : undefined;
}

function tomlHeader(server: string): string {
  return `[mcp_servers.${server}]`;
}

function tomlServerBlock(content: string, server: string): SectionBlock | undefined {
  const header = tomlHeader(server);
  const lines = content.split('\n');
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) return undefined;

  const subtablePrefix = `[mcp_servers.${server}.`;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const trimmed = (lines[index] ?? '').trim();
    if (!trimmed.startsWith('[')) continue;
    if (trimmed.startsWith(subtablePrefix)) continue;
    end = index;
    break;
  }

  return { start, end };
}

function readTomlEntry(content: string, server: string): JsonValue | undefined {
  const block = tomlServerBlock(content, server);
  if (!block) return undefined;

  const lines = content.split('\n');
  const section = lines.slice(block.start, block.end).join('\n');
  if (!section.trim()) return undefined;

  try {
    const config = readTomlConfig(section, 'mcp server entry');
    const result = jsonValueSchema.safeParse(config.mcp_servers?.[server]);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

function readTomlConfig(content: string, path: string): TomlConfig {
  if (!content.trim()) return {};

  try {
    const doc = parseToml(content);
    const result = tomlConfigSchema.safeParse(doc);
    if (!result.success) {
      throw new Error(`MCP config is not a valid object: ${path}`);
    }
    return result.data;
  } catch (error) {
    throw new Error(`MCP config is not valid TOML: ${path}`, { cause: error });
  }
}

function upsertTomlBlock(content: string, server: string, entry: McpServerEntry): string {
  const block = stringifyToml({ mcp_servers: { [server]: entry } }).trimEnd();
  const found = tomlServerBlock(content, server);

  if (found) {
    const lines = content.split('\n');
    lines.splice(found.start, found.end - found.start, ...block.split('\n'));
    return lines.join('\n');
  }

  if (!content.trim()) return `${block}\n`;

  const separator = content.endsWith('\n') ? '' : '\n';
  return `${content}${separator}\n\n${block}\n`;
}

function removeTomlBlock(content: string, server: string): RemovalResult {
  const found = tomlServerBlock(content, server);
  if (!found) return { content, changed: false };

  const lines = content.split('\n');
  lines.splice(found.start, found.end - found.start);

  return {
    content: lines.join('\n').replace(/\n{3,}/u, '\n\n'),
    changed: true,
  };
}
