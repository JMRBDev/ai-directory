import type { ResourceSummary, ResourceType } from '@ai-directory/contracts';

export type Harness = 'claude-code' | 'opencode' | 'codex';
export type Scope = 'project' | 'global';
export type Action = 'install' | 'uninstall';

export const harnessOptions: Array<{ value: Harness; label: string }> = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'codex', label: 'Codex' },
];

export function resourceId(resource: Pick<ResourceSummary, 'owner' | 'type' | 'name'>) {
  return [resource.owner, resource.type, resource.name].join('/');
}

export type PlanChange = {
  path: string;
  action: 'added' | 'modified' | 'removed';
  resource: string;
  harness: string;
  scope: string;
  before?: string;
  after?: string;
};

export type ChangePlan = {
  changes: PlanChange[];
  conflicts: string[];
  warnings: string[];
};

export type Installation = {
  resource: string;
  version: string;
  harness: string;
  scope: string;
};

export type LocalResourceState = 'managed' | 'modified' | 'missing' | 'unmanaged';
export type LocalResourceRegistryState = 'current' | 'outdated' | 'unknown';

export type LocalResource = {
  resource?: string;
  type: Exclude<ResourceType, 'templates'>;
  name: string;
  harness: Harness;
  scope: Scope;
  path: string;
  files: string[];
  state: LocalResourceState;
  registryState: LocalResourceRegistryState;
  version?: string;
  latestVersion?: string;
};
