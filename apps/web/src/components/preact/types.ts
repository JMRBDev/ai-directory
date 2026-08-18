import type { Harness } from '@ai-directory/contracts';

export type { Harness } from '@ai-directory/contracts';
export type {
  InstallationRecord as Installation,
  LocalResource,
  PlannedResourceChange as PlanChange,
  ResourceChangePlan as ChangePlan,
} from '@ai-directory/installers';
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

export function shortenHomePath(path: string, homeDir?: string) {
  if (!homeDir) return path;
  const prefix = homeDir.replace(/\/+$/, '') + '/';
  return path.startsWith(prefix) ? '~/'.concat(path.slice(prefix.length)) : path;
}

export type ChangeOperation = {
  resource: string;
  harnesses: Harness[];
  action: Action;
  version?: string;
  scope?: InstallScope;
};
