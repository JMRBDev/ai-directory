import { useState } from 'preact/hooks';
import type { ResourceType } from '@ai-directory/contracts';

export const JSON_HEADERS = { 'content-type': 'application/json' };

export const API_PATHS = {
  installed: '/api/installed',
  localResources: '/api/local-resources',
  plan: '/api/plan',
  apply: '/api/apply',
  config: '/api/config',
  githubUser: '/api/github-user',
  validate: '/api/validate',
  submit: '/api/submit',
  refresh: '/api/refresh',
} as const;

export const DRAWER_TOGGLES = {
  changeDeck: 'change-deck-toggle',
  installed: 'installed-drawer-toggle',
  settings: 'settings-drawer-toggle',
  publish: 'publish-drawer-toggle',
} as const;

export const RESOURCE_TYPE_LABELS = {
  skills: 'Skill',
  agents: 'Agent',
  rules: 'Rule',
  'mcp-servers': 'MCP Server',
  templates: 'Template',
} satisfies Record<ResourceType, string>;

export function useStatus(initialValue = '') {
  const [status, setStatus] = useState(initialValue);
  const [error, setError] = useState(false);

  function showStatus(message: string, isError = false) {
    setStatus(message);
    setError(isError);
  }

  return { status, error, showStatus };
}

export function appliedChangesMessage(changeCount: number, warnings: string[]) {
  const applied = 'Applied ' + changeCount + ' file change' + (changeCount === 1 ? '' : 's') + '.';
  const details = warnings.length > 0 ? '\n' + [...new Set(warnings)].join('\n') : '';
  return applied + details;
}
