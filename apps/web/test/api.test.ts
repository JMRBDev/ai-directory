import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, healthCheck, jsonRequest, readLocalApi, readLocalApiToken, request, writeLocalApi, writeLocalApiToken } from '../src/lib/api';

function createStorage(): Storage {
  const data = new Map<string, string>();
  // SAFETY: this test double implements the Storage methods the API client uses.
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
    clear: () => { data.clear(); },
    key: (index) => [...data.keys()][index] ?? null,
    get length() { return data.size; },
  } as Storage;
}

const originalStorage = globalThis.localStorage;

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: createStorage(),
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, 'localStorage', {
    value: originalStorage,
    configurable: true,
    writable: true,
  });
});

describe('web API client', () => {
  it('decodes successful JSON responses', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(request<{ ok: boolean }>('/api/example')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/example', expect.objectContaining({ headers: expect.any(Headers) }));
  });

  it('surfaces API error messages', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: 'Registry unavailable.' }), { status: 503 })));

    await expect(request('/api/registry')).rejects.toThrow('Registry unavailable.');
  });

  it('encodes JSON request bodies with the requested method', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ saved: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await jsonRequest('/api/config', { repository: 'https://github.com/example/registry' }, 'PUT');

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init).toBeDefined();
    expect(init?.method).toBe('PUT');
    expect(init?.body).toBe(JSON.stringify({ repository: 'https://github.com/example/registry' }));
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
  });

  it('throws a default message when the API response is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('gateway timeout', { status: 502 })));

    await expect(request('/api/registry')).rejects.toThrow('The local API request failed.');
  });

  it('refreshes the registry cache with a POST request', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.refresh()).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/refresh', expect.objectContaining({ method: 'POST' }));
  });

  it('deletes the config with the requested scope query parameter', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ repository: null, source: 'none', clearedScope: 'project' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.configDelete('project')).resolves.toMatchObject({ clearedScope: 'project' });
    expect(fetchMock).toHaveBeenCalledWith('/api/config?scope=project', expect.objectContaining({ method: 'DELETE' }));
  });

  it('reads and writes the local API base without a trailing slash', () => {
    writeLocalApi('http://127.0.0.1:4321/');
    expect(readLocalApi()).toBe('http://127.0.0.1:4321');

    writeLocalApi('');
    expect(readLocalApi()).toBe('');
  });

  it('prefixes requests with the configured local API base', async () => {
    writeLocalApi('http://127.0.0.1:4321');
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.refresh()).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:4321/api/refresh', expect.objectContaining({ method: 'POST' }));
  });

  it('reports health against the configured base', async () => {
    writeLocalApi('http://127.0.0.1:4321');
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(healthCheck()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:4321/health', expect.any(Object));
  });

  it('reports health as false when the local server is unreachable', async () => {
    writeLocalApi('http://127.0.0.1:1');
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new Error('network down')));

    await expect(healthCheck()).resolves.toBe(false);
  });

  it('stores and clears the pairing token', () => {
    writeLocalApiToken('abc123');
    expect(readLocalApiToken()).toBe('abc123');

    writeLocalApiToken('  ');
    expect(readLocalApiToken()).toBe('');
  });

  it('sends the pairing token as a bearer header', async () => {
    writeLocalApi('http://127.0.0.1:4321');
    writeLocalApiToken('secret-token');
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await api.refresh();

    const init = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret-token');
  });

  it('omits the authorization header when no token is set', async () => {
    writeLocalApi('http://127.0.0.1:4321');
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await api.refresh();

    const init = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
  });
});
