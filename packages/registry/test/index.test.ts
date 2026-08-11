import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  fetchRegistryIndex,
  readRegistryIndex,
  readResourceVersion,
  readTemplateManifest,
  readTemplateResources,
  validateRegistry,
} from '../src/index.js';

const fixturePath = fileURLToPath(new URL('./fixtures/index.json', import.meta.url));
const invalidIndexPath = fileURLToPath(new URL('./fixtures/invalid-index.json', import.meta.url));
const duplicateIndexPath = fileURLToPath(new URL('./fixtures/duplicate-index.json', import.meta.url));
const templateIndexPath = fileURLToPath(new URL('./fixtures/template-index.json', import.meta.url));

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

  it('loads a resource version and nested supporting files', async () => {
    const result = await readResourceVersion(
      fixturePath,
      'john-doe/skills/typescript-review',
    );

    expect(result.version).toBe('1.2.0');
    expect(result.files.map((file) => file.path)).toEqual([
      'SKILL.md',
      'references/checklist.md',
    ]);
  });

  it('loads a template manifest and its referenced resources', async () => {
    const template = await readResourceVersion(
      templateIndexPath,
      'john-doe/templates/review-pack',
    );

    expect(readTemplateManifest(template)).toEqual({
      name: 'review-pack',
      description: 'A review pack for TypeScript API changes.',
      resources: [
        { id: 'john-doe/skills/typescript-review', version: '1.2.0' },
        { id: 'jane-doe/agents/api-reviewer', version: '0.3.0' },
      ],
    });

    const resources = await readTemplateResources(templateIndexPath, template);

    expect(resources.map((resource) => `${resource.resource.owner}/${resource.resource.type}/${resource.resource.name}`)).toEqual([
      'john-doe/skills/typescript-review',
      'jane-doe/agents/api-reviewer',
    ]);
  });

  it('reports an unknown resource clearly', async () => {
    await expect(readResourceVersion(fixturePath, 'john-doe/skills/missing')).rejects.toThrow(
      'Resource not found: john-doe/skills/missing',
    );
  });

  it('validates required resource entry files', async () => {
    const result = await validateRegistry(fixturePath);

    expect(result).toEqual({ resourceCount: 3, issues: [] });
  });

  it('reports missing resource packages', async () => {
    const result = await validateRegistry(invalidIndexPath);

    expect(result.issues).toEqual(['Resource version not found: john-doe/skills/missing-package@1.0.0']);
  });

  it('reports duplicate resource IDs', async () => {
    const result = await validateRegistry(duplicateIndexPath);

    expect(result.issues).toContain('Duplicate resource ID: john-doe/skills/typescript-review');
  });
});
