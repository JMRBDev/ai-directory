import type {
  ChangePlan,
  ConfigResponse,
  HarnessManagerStatus,
  LocalResourcesResponse,
  PairSessionResult,
  PiMcpAdapterActionResult,
  PiMcpAdapterStatus,
  RemoteSession,
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
  piMcpAdapter: '/api/pi/mcp-adapter',
  authSessions: '/api/auth/sessions',
} as const;

export const LOCAL_API_KEY = 'ai-directory-local-api';
const LOCAL_SESSION_KEY = 'ai-directory-local-session';

type LocalSessionRecord = {
  sessionToken: string;
  id?: string;
};

export function readLocalApi(): string {
  try {
    const value = globalThis.localStorage?.getItem(LOCAL_API_KEY);
    return value ? value.trim().replace(/\/+$/u, '') : '';
  } catch {
    return '';
  }
}

export function writeLocalApi(value: string) {
  try {
    const normalized = value.trim().replace(/\/+$/u, '');
    if (normalized) globalThis.localStorage?.setItem(LOCAL_API_KEY, normalized);
    else globalThis.localStorage?.removeItem(LOCAL_API_KEY);
  } catch {
    // A private browsing session can reject localStorage. Same-origin /api still works.
  }
}

function readSessionRecord(): LocalSessionRecord | null {
  try {
    const value = globalThis.localStorage?.getItem(LOCAL_SESSION_KEY);
    if (!value) return null;
    // SAFETY: The browser stores JSON written by writeLocalSession under this application-owned key.
    const record = JSON.parse(value) as LocalSessionRecord;
    return record.sessionToken ? record : null;
  } catch {
    return null;
  }
}

function writeSessionRecord(record: LocalSessionRecord | null) {
  try {
    if (record) globalThis.localStorage?.setItem(LOCAL_SESSION_KEY, JSON.stringify(record));
    else globalThis.localStorage?.removeItem(LOCAL_SESSION_KEY);
  } catch {
    // A private browsing session can reject localStorage. Same-origin /api still works.
  }
}

export function readLocalSession(): string {
  return readSessionRecord()?.sessionToken ?? '';
}

export function readLocalSessionId(): string {
  return readSessionRecord()?.id ?? '';
}

export function writeLocalSession(sessionToken: string, id?: string) {
  const normalized = sessionToken.trim();
  if (!normalized) {
    writeSessionRecord(null);
    return;
  }
  const record: LocalSessionRecord = { sessionToken: normalized };
  if (id) record.id = id;
  writeSessionRecord(record);
}

function apiPath(path: string): string {
  const base = readLocalApi();
  return base ? `${base}${path}` : path;
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const session = readLocalSession();
  if (session) headers.set('authorization', `Bearer ${session}`);

  const response = await fetch(apiPath(path), { ...init, headers });
  // SAFETY: API responses are decoded into the caller's declared response contract.
  const result = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(result.error ?? 'The local API request failed.');
  return result;
}

/** Exchange a one-time pairing token for a session token that is then stored. */
export async function pairSession(token: string): Promise<PairSessionResult> {
  const response = await fetch(apiPath(API_PATHS.authSessions), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: token.trim() }),
  });
  // SAFETY: The sessions endpoint is contract-tested and returns this exact shape.
  const result = await response.json().catch(() => ({})) as { error?: string } & PairSessionResult;
  if (!response.ok) {
    throw new Error(result.error ?? 'The pairing token is invalid or was already used.');
  }
  return result;
}

export async function remoteSessions(): Promise<RemoteSession[]> {
  const result = await request<{ sessions: RemoteSession[] }>(API_PATHS.authSessions);
  return result.sessions;
}

export async function revokeRemoteSession(id: string): Promise<boolean> {
  const result = await request<{ ok: boolean }>(`${API_PATHS.authSessions}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return result.ok;
}

export type HealthResponse = {
  ok: boolean;
  version: string | null;
};

export type ServerHealth = {
  reachable: boolean;
  version: string | null;
};

/** The version baked into this website build at compile time. */
export function appVersion(): string {
  return __APP_VERSION__;
}

export async function serverHealth(): Promise<ServerHealth> {
  try {
    const response = await fetch(apiPath('/health'), { signal: AbortSignal.timeout(3_000) });
    if (!response.ok) return { reachable: false, version: null };
    // SAFETY: The health endpoint is contract-tested and returns this exact shape.
    const health = await response.json() as HealthResponse;
    return { reachable: true, version: health.version ?? null };
  } catch {
    return { reachable: false, version: null };
  }
}

export async function healthCheck(): Promise<boolean> {
  const health = await serverHealth();
  return health.reachable;
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
  sessions: () => remoteSessions(),
  revokeSession: (id: string) => revokeRemoteSession(id),
  harnessAction: (action: 'install' | 'update' | 'uninstall', harness: Harness) => jsonRequest<{ result: { harness: string; version?: string } }>(`${API_PATHS.harnesses}/${action}`, { harness }),
  piMcpAdapter: () => request<{ adapter: PiMcpAdapterStatus }>(API_PATHS.piMcpAdapter),
  piMcpAdapterAction: (action: 'install' | 'uninstall') => request<{ result: PiMcpAdapterActionResult }>(`${API_PATHS.piMcpAdapter}/${action}`, { method: 'POST' }),
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
