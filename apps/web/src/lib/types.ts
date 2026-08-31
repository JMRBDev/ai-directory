import type { Harness, RegistryIndex, ResourceSummary, ResourceType } from '@ai-directory/contracts';
import type { ResourceVersion } from '@ai-directory/registry';
import type {
  HarnessDetection,
  InstallationRecord as Installation,
  LocalResource,
  PlannedResourceChange as PlanChange,
  ResourceChangePlan as ChangePlan,
} from '@ai-directory/installers';

export type { Harness, ResourceSummary, ResourceType };
export type { HarnessDetection, Installation, LocalResource, PlanChange, ChangePlan };

export type HarnessOrigin = 'npm' | 'homebrew' | 'native';

export type PiMcpAdapterStatus = {
  installed: boolean;
  version?: string;
  installCommand: string;
  uninstallCommand: string;
};

export type PiMcpAdapterActionResult = {
  installed: boolean;
  command: string;
  args: string[];
  version?: string;
};

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
export type Action = 'install' | 'uninstall';

export const harnessOptions: Array<{ value: Harness; label: string }> = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'codex', label: 'Codex' },
  { value: 'pi', label: 'Pi' },
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

export type StagedItem = {
  key: string;
  resource: string;
  type: ResourceType;
  action: Action;
  harnesses: Harness[];
  scope?: InstallScope;
};

export type StagedMap = Record<string, StagedItem>;

export type ChangeOperation = {
  resource: string;
  harnesses: Harness[];
  action: Action;
  version?: string;
  scope?: InstallScope;
};

export type ConfigResponse = {
  repository: string | null;
  source: string;
  savedScope?: string;
  clearedScope?: string;
};

export type RemoteSession = {
  id: string;
  label: string;
  createdAt: string;
};

export type PairSessionResult = {
  sessionToken: string;
  session: RemoteSession;
};

export type RegistryResponse = {
  index: RegistryIndex | null;
  source: 'local' | 'remote';
  repository?: string;
  error?: string;
};

export type ResourceResponse = {
  resource: ResourceSummary;
  version: ResourceVersion | null;
  error?: string;
};

export type ApplyResponse = {
  plan: ChangePlan;
  installed?: Installation[];
  removed?: Installation[];
  warnings?: string[];
  dependencies?: Array<{ status?: { runtime?: { command?: string }; version?: string } }>;
  removedDependencies?: Array<{ candidate?: { command?: string } }>;
  dependencyRemovals?: Array<{ command: string }>;
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
