import type { ConfigScope } from '@ai-directory/config';
import { currentFile } from '../file-snapshots.js';
import { getHarnessDefinitions, type Harness } from '../harnesses.js';
import type { InstallOptions } from '../install-types.js';
import { mcpConfigPath } from './config-paths.js';
import { containerKey, readJsonConfig } from './json-config.js';
import { readTomlConfig } from './toml-config.js';

export type DiscoveredMcpServer = {
  harness: Harness;
  server: string;
  path: string;
  scope: ConfigScope;
};

export async function discoverMcpServers(
  options: InstallOptions = {},
  scopes: readonly ConfigScope[] = ['user', 'project'],
): Promise<DiscoveredMcpServer[]> {
  const harnesses = getHarnessDefinitions().map((definition) => definition.harness);
  const results: DiscoveredMcpServer[] = [];

  for (const scope of scopes) {
    for (const harness of harnesses) {
      const path = await mcpConfigPath(harness, scope, options);
      const content = await currentFile(path);
      if (content === null) continue;

      for (const server of mcpServerNames(harness, content, path)) {
        results.push({ harness, server, path, scope });
      }
    }
  }

  return results;
}

export function isEmptyMcpConfig(harness: Harness, content: string, path: string): boolean {
  if (harness === 'codex') {
    const config = readTomlConfig(content, path);
    return Object.keys(config).every((key) => key === 'mcp_servers')
      && Object.keys(config.mcp_servers ?? {}).length === 0;
  }

  const config = readJsonConfig(content, path);
  const container = containerKey(harness);
  return Object.keys(config).every((key) => key === container)
    && Object.keys(config[container] ?? {}).length === 0;
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
