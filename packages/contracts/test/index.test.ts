import { describe, expect, it } from 'vitest';
import { registryIndexSchema } from '../src/index.js';

const resource = {
  owner: 'john-doe',
  type: 'skills',
  name: 'typescript-review',
  description: 'Review TypeScript changes.',
  latestVersion: '1.2.0',
  reviewStatus: 'reviewed',
  lifecycleStatus: 'active',
  visibility: 'public',
  updatedAt: '2026-08-11T10:00:00Z',
};

describe('registry index contract', () => {
  it('accepts a valid resource index', () => {
    expect(registryIndexSchema.parse({ schemaVersion: 1, resources: [resource] })).toEqual({
      schemaVersion: 1,
      resources: [resource],
    });
  });

  it('rejects invalid resource identifiers', () => {
    const result = registryIndexSchema.safeParse({
      schemaVersion: 1,
      resources: [{ ...resource, name: 'Not a slug' }],
    });

    expect(result.success).toBe(false);
  });
});
