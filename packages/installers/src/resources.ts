import type { ResourceKind } from './adapters.js';

export function resourceType(resource: string): ResourceKind | undefined {
  const type = resource.split('/')[1];
  return type === 'skills' || type === 'agents' || type === 'rules' || type === 'plugins' || type === 'tools'
    ? type
    : undefined;
}
