import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonRequest, request } from '../src/lib/api';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('web API client', () => {
  it('decodes successful JSON responses', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(request<{ ok: boolean }>('/api/example')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/example', undefined);
  });

  it('surfaces API error messages', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: 'Registry unavailable.' }), { status: 503 })));

    await expect(request('/api/registry')).rejects.toThrow('Registry unavailable.');
  });

  it('encodes JSON request bodies with the requested method', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ saved: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await jsonRequest('/api/config', { repository: 'https://github.com/example/registry' }, 'PUT');

    expect(fetchMock).toHaveBeenCalledWith('/api/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repository: 'https://github.com/example/registry' }),
    });
  });
});
