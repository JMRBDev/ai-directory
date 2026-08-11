import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readRegistryIndex } from '../src/index.js';

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
});
