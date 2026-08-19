import { useState } from 'preact/hooks';
import { harnessSchema, resourceTypeSchema, type ResourceType } from '@ai-directory/contracts';
import { z } from 'zod';
import type { StagedItem, StagedMap } from './ChangeDeckContext';
import type { Harness } from './types';

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

export const STAGE_RESOURCE_EVENT = 'ai-directory:stage-resource';
export const UNSTAGE_RESOURCE_EVENT = 'ai-directory:unstage-resource';
export const STAGED_CHANGES_EVENT = 'ai-directory:staged-changes';
export const HARNESS_DEFAULTS_EVENT = 'ai-directory:harness-defaults';
const STAGED_CHANGES_STORAGE_KEY = 'ai-directory:staged-changes-v1';
const HARNESS_DEFAULTS_STORAGE_KEY = 'ai-directory:harness-defaults-v1';
const DEFAULT_HARNESSES: Harness[] = ['claude-code'];

const stagedItemSchema = z.object({
  key: z.string().min(1),
  resource: z.string().min(1),
  type: resourceTypeSchema,
  action: z.enum(['install', 'uninstall']),
  harnesses: z.array(harnessSchema).min(1),
  scope: z.enum(['user', 'project']).optional(),
});
const stagedMapSchema = z.record(z.string(), stagedItemSchema);

export function readStagedChanges(): StagedMap {
  try {
    const raw = globalThis.localStorage?.getItem(STAGED_CHANGES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = stagedMapSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return {};
    const restored: StagedMap = {};
    for (const [key, item] of Object.entries(parsed.data)) {
      const next: StagedItem = {
        key: item.key,
        resource: item.resource,
        type: item.type,
        action: item.action,
        harnesses: item.harnesses,
      };
      if (item.scope) next.scope = item.scope;
      restored[key] = next;
    }
    return restored;
  } catch {
    return {};
  }
}

export function persistStagedChanges(staged: StagedMap) {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    storage.setItem(STAGED_CHANGES_STORAGE_KEY, JSON.stringify(staged));
    globalThis.dispatchEvent(new CustomEvent<StagedMap>(STAGED_CHANGES_EVENT, { detail: staged }));
  } catch {
  }
}

export function readHarnessDefaults(): Harness[] {
  try {
    const raw = globalThis.localStorage?.getItem(HARNESS_DEFAULTS_STORAGE_KEY);
    if (!raw) return [...DEFAULT_HARNESSES];
    const parsed = z.array(harnessSchema).min(1).safeParse(JSON.parse(raw));
    if (!parsed.success) return [...DEFAULT_HARNESSES];
    return [...new Set(parsed.data)];
  } catch {
    return [...DEFAULT_HARNESSES];
  }
}

export function persistHarnessDefaults(harnesses: Harness[]) {
  if (harnesses.length === 0) return;
  try {
    const next = [...new Set(harnesses)];
    const storage = globalThis.localStorage;
    if (!storage) return;
    storage.setItem(HARNESS_DEFAULTS_STORAGE_KEY, JSON.stringify(next));
    globalThis.dispatchEvent(new CustomEvent<Harness[]>(HARNESS_DEFAULTS_EVENT, { detail: next }));
  } catch {
  }
}

export function harnessLabel(harness: Harness) {
  return harness === 'claude-code' ? 'Claude Code' : harness === 'opencode' ? 'OpenCode' : 'Codex';
}

export const RESOURCE_TYPE_LABELS = {
  skills: 'Skill',
  agents: 'Agent',
  rules: 'Rule',
  'mcp-servers': 'MCP Server',
  templates: 'Resource pack',
  plugins: 'Plugin',
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
