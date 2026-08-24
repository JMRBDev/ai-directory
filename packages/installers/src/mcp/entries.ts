import { mcpEnvTokens, mcpEnvTokenPattern, type McpServerManifest } from '@ai-directory/contracts';
import type { Harness } from '../harnesses.js';
import type {
  CodexHeaders,
  McpEntryResult,
  McpOauth,
  McpServerEntry,
  StringMap,
} from './types.js';

const reservedClaudeServers = new Set([
  'workspace',
  'claude-in-chrome',
  'computer-use',
  'Claude Preview',
  'Claude Browser',
]);

export function validateServerName(harness: Harness, server: string): void {
  if (harness === 'claude-code' && reservedClaudeServers.has(server)) {
    throw new Error(`MCP server name "${server}" is reserved by Claude Code.`);
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

export function mcpEntryFor(harness: Harness, manifest: McpServerManifest): McpEntryResult {
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

export function envNotesFor(
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
