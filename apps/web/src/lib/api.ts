import type {
  ChangePlan,
  ConfigResponse,
  HarnessManagerStatus,
  LocalResourcesResponse,
  RegistryResponse,
  ResourceResponse,
  Installation,
  ApplyResponse,
  Harness,
} from './types';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonRequestBody = { [key: string]: JsonValue };

export const API_PATHS = {
  registry: '/api/registry',
  resource: '/api/registry/resource',
  installed: '/api/installed',
  localResources: '/api/local-resources',
  harnesses: '/api/harnesses',
  plan: '/api/plan',
  apply: '/api/apply',
  config: '/api/config',
  githubUser: '/api/github-user',
  validate: '/api/validate',
  submit: '/api/submit',
  refresh: '/api/refresh',
} as const;

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  // SAFETY: API responses are decoded into the caller's declared response contract.
  const result = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(result.error ?? 'The local API request failed.');
  return result;
}

export function jsonRequest<T>(path: string, body: JsonRequestBody, method = 'POST') {
  return request<T>(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export const api = {
  registry: () => request<RegistryResponse>(API_PATHS.registry),
  resource: (owner: string, type: string, name: string) => request<ResourceResponse>(
    `${API_PATHS.resource}/${encodeURIComponent(owner)}/${encodeURIComponent(type)}/${encodeURIComponent(name)}`,
  ),
  installed: () => request<{ installations?: Installation[] }>(API_PATHS.installed),
  localResources: () => request<LocalResourcesResponse>(API_PATHS.localResources),
  harnesses: () => request<{ harnesses: HarnessManagerStatus[] }>(API_PATHS.harnesses),
  harnessAction: (action: 'install' | 'update' | 'uninstall', harness: Harness) => jsonRequest<{ result: { harness: string; version?: string } }>(`${API_PATHS.harnesses}/${action}`, { harness }),
  config: () => request<ConfigResponse>(API_PATHS.config),
  configPut: (repository: string, scope: 'user' | 'project') => jsonRequest<ConfigResponse>(API_PATHS.config, { repository, scope }, 'PUT'),
  configDelete: (scope: 'user' | 'project') => request<ConfigResponse>(`${API_PATHS.config}?scope=${encodeURIComponent(scope)}`, { method: 'DELETE' }),
  refresh: () => request<{ ok: boolean }>(API_PATHS.refresh, { method: 'POST' }),
  githubUser: () => request<{ username: string }>(API_PATHS.githubUser),
  validate: (body: FormData) => request<{
    resource: string;
    version: string;
    description?: string;
    entryFile: string;
    files: string[];
  }>(API_PATHS.validate, { method: 'POST', body }),
  submit: (body: FormData) => request<{
    resource: string;
    branch: string;
    commit: string;
    pullRequestUrl: string;
    files: string[];
  }>(API_PATHS.submit, { method: 'POST', body }),
  plan: (operations: JsonValue[], force = false) => jsonRequest<ChangePlan>(API_PATHS.plan, { operations, force }),
  apply: (body: JsonRequestBody) => jsonRequest<ApplyResponse>(API_PATHS.apply, body),
};
