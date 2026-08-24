import {
  harnessOptions,
  RESOURCE_TYPE_LABELS,
  type ChangePlan,
  type Harness,
  type InstallScope,
  type LocalResource,
  type ResourceSummary,
  type ResourceType,
  type StagedItem,
} from '../../lib/types';

export type SheetName = 'changes' | 'installed' | 'settings' | 'publish' | null;
export type ReviewFilter = 'all' | 'reviewed' | 'unreviewed';
export type InstalledFilter = 'all' | 'installed' | 'not-installed';
export type SortOption = 'updated' | 'name' | 'version';
export type HarnessFilter = 'all' | Harness;
export type SourceFilter = 'all' | 'registry' | 'local';
export type DirectoryFile = File & { webkitRelativePath?: string };

export type PublishReview = {
  resource: string;
  version: string;
  description: string;
  entryFile: string;
  files: string[];
};

export const LOCAL_STATE_LABELS = {
  managed: 'Managed',
  modified: 'Modified',
  missing: 'Missing',
  unmanaged: 'Unmanaged',
} satisfies Record<LocalResource['state'], string>;

export const REGISTRY_STATE_LABELS = {
  current: 'Current',
  outdated: 'Outdated',
  unknown: 'Unknown source',
} satisfies Record<LocalResource['registryState'], string>;

export const RESOURCE_TYPES = [
  { value: 'skills', label: `${RESOURCE_TYPE_LABELS.skills}s` },
  { value: 'agents', label: `${RESOURCE_TYPE_LABELS.agents}s` },
  { value: 'rules', label: `${RESOURCE_TYPE_LABELS.rules}s` },
  { value: 'mcp-servers', label: `${RESOURCE_TYPE_LABELS['mcp-servers']}s` },
  { value: 'templates', label: `${RESOURCE_TYPE_LABELS.templates}s` },
  { value: 'plugins', label: `${RESOURCE_TYPE_LABELS.plugins}s` },
  { value: 'tools', label: `${RESOURCE_TYPE_LABELS.tools}s` },
] satisfies Array<{ value: ResourceType; label: string }>;

export const PAGE_SIZE = 6;

export function readStorage<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    // SAFETY: The browser stores JSON written by writeStorage under this application-owned key.
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

export function writeStorage<T>(key: string, value: T) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A private browsing session can reject localStorage. The UI still works for this session.
  }
}

export function subscribeSystemTheme(onChange: () => void) {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const handleChange = () => {
    if (document.documentElement.dataset.themePreference === 'system') {
      document.documentElement.classList.toggle('dark', media.matches);
    }
    onChange();
  };
  media.addEventListener('change', handleChange);
  return () => media.removeEventListener('change', handleChange);
}

export function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function getServerSystemTheme() {
  return false;
}

export function isMarkdownPath(path: string) {
  return /\.(md|markdown)$/i.test(path);
}

export function stripFrontmatter(content: string) {
  const match = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(content);
  return match ? content.slice(match[0].length) : content;
}

export function updatedLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
}

export function mergePlans(plans: ChangePlan[]): ChangePlan {
  return {
    operations: plans.flatMap((plan) => plan.operations ?? []),
    changes: plans.flatMap((plan) => plan.changes),
    conflicts: [...new Set(plans.flatMap((plan) => plan.conflicts))],
    warnings: [...new Set(plans.flatMap((plan) => plan.warnings))],
    projectionNotes: [...new Set(plans.flatMap((plan) => plan.projectionNotes))],
    dependencyRemovals: plans.flatMap((plan) => plan.dependencyRemovals ?? []),
    fingerprint: '',
  };
}

export function hasApplyableOperation(plan: ChangePlan) {
  return plan.changes.length > 0 || plan.operations.some((operation) => operation.action === 'uninstall');
}

export function operationsFor(items: StagedItem[], fallbackHarnesses: Harness[], fallbackScope: InstallScope) {
  return items.map((item) => {
    const operation = {
      resource: item.resource,
      action: item.action,
      harnesses: item.harnesses.length > 0 ? item.harnesses : fallbackHarnesses,
    };
    if (item.type === 'mcp-servers') return { ...operation, scope: item.scope ?? fallbackScope };
    return operation;
  });
}

export function reviewFilter(value: string): ReviewFilter {
  return value === 'reviewed' || value === 'unreviewed' ? value : 'all';
}

export function installedFilter(value: string): InstalledFilter {
  return value === 'installed' || value === 'not-installed' ? value : 'all';
}

export function sortOption(value: string): SortOption {
  return value === 'name' || value === 'version' ? value : 'updated';
}

export function installScope(value: string): InstallScope {
  return value === 'project' ? 'project' : 'user';
}

export function resourceType(value: string): ResourceType {
  return RESOURCE_TYPES.find((option) => option.value === value)?.value ?? 'skills';
}

export function activeResourceType(resources: Array<Pick<ResourceSummary, 'type'>>, selected?: ResourceType): ResourceType {
  return selected ?? resources[0]?.type ?? 'skills';
}

export function parseHarnessFilter(value: string): HarnessFilter {
  if (value === 'all') return value;
  return harnessOptions.find((option) => option.value === value)?.value ?? 'all';
}

export function parseSourceFilter(value: string): SourceFilter {
  return value === 'registry' || value === 'local' ? value : 'all';
}

export function groupStaged(items: StagedItem[]) {
  return [
    { name: 'mcp', items: items.filter((item) => item.type === 'mcp-servers') },
    { name: 'files', items: items.filter((item) => item.type !== 'mcp-servers') },
  ].filter((group) => group.items.length > 0);
}

export type GroupPlan = { name: string; items: StagedItem[]; plan: ChangePlan };
export type PlanData = { plan: ChangePlan; groups: GroupPlan[] };
