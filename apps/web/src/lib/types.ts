import type { Harness, RegistryIndex, ResourceSummary, ResourceType } from '@ai-directory/contracts';
import type { ResourceVersion } from '@ai-directory/registry';
import type {
  HarnessDetection,
  InstallationRecord as Installation,
  LocalResource,
} from '@ai-directory/installers';

export type { Harness, ResourceSummary, ResourceType };
export type { HarnessDetection, Installation, LocalResource };

export type HarnessOrigin = 'npm' | 'homebrew' | 'native';

export type HarnessManagerStatus = HarnessDetection & {
  installed: boolean;
  installCommand: string;
  upgradeCommand: string;
  uninstallCommand: string;
  version?: string;
  origin?: HarnessOrigin;
  originPath?: string;
};

export type InstallScope = 'user' | 'project';

export const harnessOptions: Array<{ value: Harness; label: string }> = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'codex', label: 'Codex' },
];

export const scopeOptions: Array<{ value: InstallScope; label: string; hint: string }> = [
  { value: 'user', label: 'User', hint: 'Available in all your projects' },
  { value: 'project', label: 'Project', hint: 'Shared with the team in this project' },
];

export const RESOURCE_TYPE_LABELS = {
  skills: 'Skill',
  agents: 'Agent',
  rules: 'Rule',
  'mcp-servers': 'MCP Server',
  templates: 'Resource pack',
  plugins: 'Plugin',
  tools: 'Tool',
} satisfies Record<ResourceType, string>;

export type ConfigResponse = {
  repository: string | null;
  source: string;
  savedScope?: string;
  clearedScope?: string;
};

export type RegistryResponse = {
  index: RegistryIndex | null;
  source: 'local' | 'remote' | 'none';
  repository?: string;
  error?: string;
};

export type ResourceResponse = {
  resource: ResourceSummary;
  version: ResourceVersion | null;
  error?: string;
};

export type LocalResourcesResponse = {
  resources?: LocalResource[];
  registryError?: string;
  homeDirectory?: string;
};

export function shortenHomePath(path: string, homeDir?: string) {
  if (!homeDir) return path;
  const prefix = homeDir.replace(/\/+$/u, '') + '/';
  return path.startsWith(prefix) ? '~/' + path.slice(prefix.length) : path;
}

export function harnessLabel(harness: Harness) {
  return harnessOptions.find((option) => option.value === harness)?.label ?? harness;
}

export function detailPath(resource: Pick<ResourceSummary, 'owner' | 'type' | 'name'>) {
  return `/resources/${resource.owner}/${resource.type}/${resource.name}`;
}

export function resourceLabel(resource: Pick<LocalResource, 'resource' | 'name' | 'type'>) {
  return resource.resource ?? `${RESOURCE_TYPE_LABELS[resource.type]}: ${resource.name}`;
}
