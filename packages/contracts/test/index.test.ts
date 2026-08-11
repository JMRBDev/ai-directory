import { describe, expect, it } from 'vitest';
import {
  registryIndexSchema,
  resourceIdSchema,
  templateManifestSchema,
} from '../src/index.js';

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

describe('template manifest contract', () => {
  it('accepts installable resource references', () => {
    expect(
      templateManifestSchema.parse({
        name: 'review-pack',
        description: 'A review pack.',
        resources: [{ id: 'john-doe/skills/typescript-review', version: '1.2.0' }],
      }),
    ).toMatchObject({ name: 'review-pack' });
  });

  it('rejects nested template references', () => {
    const result = templateManifestSchema.safeParse({
      name: 'review-pack',
      description: 'A review pack.',
      resources: [{ id: 'john-doe/templates/other-pack', version: '1.0.0' }],
    });

    expect(result.success).toBe(false);
  });
});

describe('resource ID contract', () => {
  it('accepts owner, type, and name identifiers', () => {
    expect(resourceIdSchema.parse('john-doe/skills/typescript-review')).toBe(
      'john-doe/skills/typescript-review',
    );
  });

  it('rejects malformed identifiers', () => {
    expect(resourceIdSchema.safeParse('John Doe/skills/my-skill').success).toBe(false);
  });
});
