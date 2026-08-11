import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fetchRegistryIndex, readRegistryIndex } from '../src/index.js';

const fixturePath = fileURLToPath(new URL('./fixtures/index.json', import.meta.url));

describe('readRegistryIndex', () => {
  it('loads a valid index', async () => {
    const index = await readRegistryIndex(fixturePath);

    expect(index.resources).toHaveLength(3);
  });

  it('reports a missing index clearly', async () => {
    await expect(readRegistryIndex('/missing/registry-index.json')).rejects.toThrow(
      'Registry index not found: /missing/registry-index.json',
    );
  });

  it('loads an index from a remote source', async () => {
    const index = await fetchRegistryIndex(
      'https://registry.test/index.json',
      async () =>
        new Response(JSON.stringify({ schemaVersion: 1, resources: [] }), { status: 200 }),
    );

    expect(index.resources).toEqual([]);
  });

  it('reports remote HTTP failures clearly', async () => {
    await expect(
      fetchRegistryIndex(
        'https://registry.test/index.json',
        async () => new Response(null, { status: 503, statusText: 'Unavailable' }),
      ),
    ).rejects.toThrow('Registry index request failed (503 Unavailable)');
  });
});
