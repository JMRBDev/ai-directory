import type { ResourceSummary } from '@ai-directory/contracts';

export function resourceKey(resource: Pick<ResourceSummary, 'owner' | 'type' | 'name'>): string {
  return `${resource.owner}/${resource.type}/${resource.name}`;
}
