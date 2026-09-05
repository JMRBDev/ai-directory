import {
  harnessOptions,
  RESOURCE_TYPE_LABELS,
  type Harness,
  type InstallScope,
  type LocalResource,
  type ResourceSummary,
  type ResourceType,
} from '../../lib/types';

export type SheetName = 'installed' | 'settings' | 'batch' | null;
export type ReviewFilter = 'all' | 'reviewed' | 'unreviewed';
export type InstalledFilter = 'all' | 'installed' | 'not-installed';
export type SortOption = 'updated' | 'name' | 'version';
export type HarnessFilter = 'all' | Harness;
export type SourceFilter = 'all' | 'registry' | 'local';

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

export function isMarkdownPath(path: string) {
  return /\.(md|markdown)$/i.test(path);
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
