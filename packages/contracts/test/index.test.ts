import { describe, expect, it } from 'vitest';
import {
  mcpServerManifestSchema,
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

describe('MCP server manifest contract', () => {
  it('accepts a remote HTTP server with env-backed headers', () => {
    expect(
      mcpServerManifestSchema.parse({
        name: 'github',
        description: 'GitHub MCP server.',
        transport: 'http',
        url: 'https://api.githubcopilot.com/mcp/',
        headers: {
          Authorization: 'Bearer {env:GITHUB_PAT}',
          'X-MCP-Insiders': 'true',
        },
        env: [{ name: 'GITHUB_PAT', required: true }],
      }),
    ).toMatchObject({ name: 'github', transport: 'http' });
  });

  it('accepts a stdio server with env passthrough', () => {
    expect(
      mcpServerManifestSchema.parse({
        name: 'db',
        description: 'Database MCP server.',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@bytebase/dbhub'],
        env: [{ name: 'DATABASE_URL', required: true }],
      }),
    ).toMatchObject({ name: 'db', transport: 'stdio' });
  });

  it('rejects an HTTP server without a url', () => {
    expect(
      mcpServerManifestSchema.safeParse({
        name: 'broken',
        description: 'Broken.',
        transport: 'http',
      }).success,
    ).toBe(false);
  });

  it('rejects a remote server that declares an env variable it never references', () => {
    expect(
      mcpServerManifestSchema.safeParse({
        name: 'broken',
        description: 'Broken.',
        transport: 'http',
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer {env:OTHER}' },
        env: [{ name: 'TOKEN', required: true }],
      }).success,
    ).toBe(false);
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
