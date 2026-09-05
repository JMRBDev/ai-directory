import type {
  ConfigResponse,
  HarnessManagerStatus,
  InstallScope,
  LocalResourcesResponse,
  RegistryResponse,
  ResourceResponse,
  Installation,
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
  config: '/api/config',
  refresh: '/api/refresh',
  install: '/api/install',
  update: '/api/update',
  uninstall: '/api/installed',
} as const;

// The website is always served by `aid web` from the same origin, so every
// request goes to the local server directly. No base URL, no tokens.
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

export type InstallRequest = {
  resource: string;
  harnesses: Harness[];
  scope?: InstallScope;
};

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
  install: (body: JsonRequestBody) => jsonRequest<{ records: Installation[]; warnings: string[] }>(API_PATHS.install, body),
  update: (body: JsonRequestBody) => jsonRequest<{ updated: boolean; harnesses: Harness[]; records: Installation[]; warnings: string[] }>(API_PATHS.update, body),
  uninstall: (resource: string, harnesses: Harness[], scope?: string, force = false) => request<{ removed: Installation[] }>(`${API_PATHS.uninstall}?resource=${encodeURIComponent(resource)}&harnesses=${encodeURIComponent(harnesses.join(','))}${scope ? `&scope=${encodeURIComponent(scope)}` : ''}${force ? '&force=true' : ''}`, { method: 'DELETE' }),
};
