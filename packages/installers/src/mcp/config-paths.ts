import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ConfigScope } from '@ai-directory/config';
import { resolveHarnessPaths, type Harness } from '../harnesses.js';
import { pickOpenCodeConfig } from '../opencode-config.js';
import type { InstallOptions } from '../install-types.js';

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

export async function mcpConfigPath(
  harness: Harness,
  scope: ConfigScope,
  options: InstallOptions,
): Promise<string> {
  if (scope === 'project') {
    return projectConfigPaths[harness](resolve(options.cwd ?? process.cwd()));
  }

  return userConfigPaths[harness](resolve(options.homeDirectory ?? homedir()), options);
}
