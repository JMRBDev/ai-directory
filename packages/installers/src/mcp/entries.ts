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
} satisfies Partial<Record<Harness, (manifest: McpServerManifest) => McpEntryResult>>;

export function mcpUnsupportedError(harness: string): string {
  return `MCP servers are not supported by ${harness}.`;
}

export function mcpEntryFor(harness: Harness, manifest: McpServerManifest): McpEntryResult {
  if (!(harness in mcpEntries)) {
    throw new Error(mcpUnsupportedError(harness));
  }
  // SAFETY: the `in` guard narrows harness to a key of the mcpEntries record.
  const resolver = mcpEntries[harness as keyof typeof mcpEntries];
  return resolver(manifest);
}

type EnvFormat = (name: string) => string;

type DollarBraceOauth = {
  kind: 'dollar-brace';
};

type EnvBraceOauth = {
  kind: 'env-brace';
};

type OauthShape = DollarBraceOauth | EnvBraceOauth;

type StdioShape =
  | { kind: 'command'; envKey: 'env' }
  | { kind: 'local'; envKey: 'environment' };

type RemoteShape =
  | { kind: 'transport'; headersKey: 'headers' }
  | { kind: 'remote'; headersKey: 'headers' };

function requireCommand(manifest: McpServerManifest): string {
  if (!manifest.command) throw new Error(`MCP server ${manifest.name} has no command.`);
  return manifest.command;
}

function requireUrl(manifest: McpServerManifest): string {
  if (!manifest.url) throw new Error(`MCP server ${manifest.name} has no url.`);
  return manifest.url;
}

function oauthEntry(manifest: McpServerManifest, shape: OauthShape): McpOauth | undefined {
  if (!manifest.oauth) return undefined;
  if (shape.kind === 'dollar-brace') {
    const oauth: McpOauth = {};
    if (manifest.oauth.clientId) oauth.clientId = manifest.oauth.clientId;
    if (manifest.oauth.scopes && manifest.oauth.scopes.length > 0) {
      oauth.scopes = manifest.oauth.scopes.join(' ');
    }
    if (manifest.oauth.callbackPort) oauth.callbackPort = manifest.oauth.callbackPort;
    return oauth;
  }

  const oauth: McpOauth = {};
  if (manifest.oauth.clientId) oauth.clientId = manifest.oauth.clientId;
  if (manifest.oauth.clientSecretVar) {
    oauth.clientSecret = `{env:${manifest.oauth.clientSecretVar}}`;
  }
  if (manifest.oauth.scopes && manifest.oauth.scopes.length > 0) {
    oauth.scope = manifest.oauth.scopes.join(' ');
  }
  return oauth;
}

function stdioEntry(
  manifest: McpServerManifest,
  envFormat: EnvFormat,
  shape: StdioShape,
  oauthShape: OauthShape,
): McpServerEntry {
  const command = requireCommand(manifest);
  const entry: McpServerEntry = shape.kind === 'local'
    ? { type: 'local', command: [command, ...(manifest.args ?? [])] }
    : { command };
  if (shape.kind === 'command' && manifest.args && manifest.args.length > 0) {
    entry.args = manifest.args;
  }
  const env = stdioEnv(manifest, envFormat);
  if (Object.keys(env).length > 0) entry[shape.envKey] = env;
  if (manifest.cwd) entry.cwd = manifest.cwd;
  const oauth = oauthEntry(manifest, oauthShape);
  if (oauth) entry.oauth = oauth;
  return entry;
}

function remoteEntry(
  manifest: McpServerManifest,
  envFormat: EnvFormat,
  shape: RemoteShape,
  oauthShape: OauthShape,
): McpServerEntry {
  const url = requireUrl(manifest);
  const entry: McpServerEntry = shape.kind === 'remote'
    ? { type: 'remote', url }
    : manifest.transport === 'stdio'
      ? { url }
      : { type: manifest.transport, url };
  const headers = rewriteHeaders(manifest, envFormat);
  if (Object.keys(headers).length > 0) entry[shape.headersKey] = headers;
  const oauth = oauthEntry(manifest, oauthShape);
  if (oauth) entry.oauth = oauth;
  return entry;
}

function shellEntry(
  manifest: McpServerManifest,
  envFormat: EnvFormat,
  stdio: StdioShape,
  remote: RemoteShape,
  oauth: OauthShape,
): McpServerEntry {
  return manifest.transport === 'stdio'
    ? stdioEntry(manifest, envFormat, stdio, oauth)
    : remoteEntry(manifest, envFormat, remote, oauth);
}

function claudeMcpEntry(manifest: McpServerManifest): McpServerEntry {
  return shellEntry(
    manifest,
    (name) => `\${${name}}`,
    { kind: 'command', envKey: 'env' },
    { kind: 'transport', headersKey: 'headers' },
    { kind: 'dollar-brace' },
  );
}

function openCodeMcpEntry(manifest: McpServerManifest): McpServerEntry {
  return shellEntry(
    manifest,
    (name) => `{env:${name}}`,
    { kind: 'local', envKey: 'environment' },
    { kind: 'remote', headersKey: 'headers' },
    { kind: 'env-brace' },
  );
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
