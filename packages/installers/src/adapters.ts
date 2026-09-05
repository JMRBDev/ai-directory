import type { Harness } from './harnesses.js';
import { installClaudeCodeResources } from './plans/claude-code.js';
import { installOpenCodeResources } from './plans/opencode.js';
import { installCodexResources } from './plans/codex.js';
import type { InstallOptions, InstallResult } from './install-types.js';
import type { ResourceVersion } from '@ai-directory/registry';

export type ResourceInstallationMode = 'native' | 'translated' | 'configured' | 'unsupported';

export type ResourceKind = Exclude<ResourceVersion['resource']['type'], 'templates'>;

export type HarnessAdapter = {
  harness: Harness;
  installation: 'native-filesystem';
  capabilities: Record<ResourceKind, ResourceInstallationMode>;
  install(resources: ResourceVersion[], options: InstallOptions): Promise<InstallResult[]>;
};

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

function isAdapterKey(value: string): value is keyof typeof harnessAdapters {
  return value in harnessAdapters;
}

export function getHarnessAdapter(value: string): HarnessAdapter {
  if (!isAdapterKey(value)) {
    throw new Error(`Unsupported harness: ${value}`);
  }

  return harnessAdapters[value];
}
