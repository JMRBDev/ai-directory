import type { ResourceType } from '@ai-directory/contracts';
import { resourceKey } from '@ai-directory/domain';

export type Harness = 'claude-code' | 'opencode' | 'codex';
export type InstallScope = 'user' | 'project';
export type Action = 'install' | 'uninstall';

export const harnessOptions: Array<{ value: Harness; label: string }> = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'codex', label: 'Codex' },
];

export const scopeOptions: Array<{ value: InstallScope; label: string; hint: string }> = [
  { value: 'user', label: 'User', hint: 'Available in all your projects' },
  { value: 'project', label: 'Project', hint: 'Shared with the team in this project' },
];

export { resourceKey as resourceId };

export function shortenHomePath(path: string, homeDir?: string) {
  if (!homeDir) return path;
  const prefix = homeDir.replace(/\/+$/, '') + '/';
  return path.startsWith(prefix) ? '~/'.concat(path.slice(prefix.length)) : path;
}

export type PlanChange = {
  path: string;
  action: 'added' | 'modified' | 'removed';
  resource: string;
  harness: string;
  before?: string;
  after?: string;
};

export type ChangeOperation = {
  resource: string;
  harnesses: Harness[];
  action: Action;
  version?: string;
  scope?: InstallScope;
};

export type ChangePlan = {
  changes: PlanChange[];
  conflicts: string[];
  warnings: string[];
  projectionNotes: string[];
  fingerprint: string;
  operations?: ChangeOperation[];
};

export type Installation = {
  resource: string;
  version: string;
  harness: string;
  kind?: 'files' | 'mcp';
  scope?: InstallScope;
};

export type LocalResourceState = 'managed' | 'modified' | 'missing' | 'unmanaged';
export type LocalResourceRegistryState = 'current' | 'outdated' | 'unknown';

export type LocalResource = {
  resource?: string;
  type: Exclude<ResourceType, 'templates'>;
  name: string;
  harness: Harness;
  path: string;
  files: string[];
  state: LocalResourceState;
  registryState: LocalResourceRegistryState;
  version?: string;
  latestVersion?: string;
  scope?: InstallScope;
};
