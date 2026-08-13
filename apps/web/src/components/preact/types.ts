import type { ResourceSummary } from '@ai-directory/contracts';

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
