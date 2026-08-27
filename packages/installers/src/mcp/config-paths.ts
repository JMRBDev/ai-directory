import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ConfigScope } from '@ai-directory/config';
import { resolveHarnessPaths, type Harness } from '../harnesses.js';
import { pickOpenCodeConfig } from '../opencode-config.js';
import type { InstallOptions } from '../install-types.js';

type ConfigPathResolver = (root: string, options: InstallOptions) => string | Promise<string>;

const projectConfigPaths = {
  'claude-code': (cwd: string) => join(cwd, '.mcp.json'),
  opencode: async (cwd: string) =>
    pickOpenCodeConfig([join(cwd, 'opencode.jsonc'), join(cwd, 'opencode.json')]),
  codex: (cwd: string) => join(cwd, '.codex', 'config.toml'),
  pi: (cwd: string) => join(cwd, '.mcp.json'),
} satisfies Partial<Record<Harness, ConfigPathResolver>>;

const userConfigPaths = {
  'claude-code': (home: string) => join(home, '.claude.json'),
  opencode: async (home: string, options: InstallOptions) => {
    const root = resolveHarnessPaths('opencode', options).root;
    return pickOpenCodeConfig([join(root, 'opencode.jsonc'), join(root, 'opencode.json')]);
  },
  codex: (home: string, options: InstallOptions) =>
    join(resolveHarnessPaths('codex', options).config, 'config.toml'),
  pi: (home: string, options: InstallOptions) =>
    join(resolveHarnessPaths('pi', options).config, 'mcp.json'),
} satisfies Partial<Record<Harness, ConfigPathResolver>>;

export function supportsMcp(harness: Harness): boolean {
  return harness in projectConfigPaths || harness in userConfigPaths;
}

export async function mcpConfigPath(
  harness: Harness,
  scope: ConfigScope,
  options: InstallOptions,
): Promise<string> {
  const resolvers = scope === 'project' ? projectConfigPaths : userConfigPaths;
  if (!(harness in resolvers)) {
    throw new Error(`MCP servers are not supported by ${harness}.`);
  }
  // SAFETY: the `in` guard narrows harness to a key of the resolvers record.
  const resolver = resolvers[harness as keyof typeof resolvers];
  const root = scope === 'project'
    ? resolve(options.cwd ?? process.cwd())
    : resolve(options.homeDirectory ?? homedir());

  return resolver(root, options);
}
