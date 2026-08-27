import { describe, expect, it } from 'vitest';
import {
  applyPlannedChange,
  changeOptions,
  resolveOperations,
  type ApplyOutcome,
} from '../src/index.js';
import type { ChangeOperationData } from '../src/index.js';
import type { RegistrySnapshot } from '@ai-directory/registry';

function snapshot(_resources: string[]): RegistrySnapshot {
  return {
    source: { type: 'local', indexPath: '/tmp/index.json' },
    indexPath: '/tmp/index.json',
    readIndex: async () => ({ schemaVersion: 1, resources: [] }),
    readResource: async (resourceId: string) => ({
      resource: {
        resource: {
          owner: resourceId.split('/')[0] ?? '',
          // SAFETY: The split position of a resource ID is always the resource type.
          type: resourceId.split('/')[1] as 'skills',
          name: resourceId.split('/')[2] ?? '',
          description: '',
          latestVersion: '1.0.0',
          reviewStatus: 'unreviewed',
          lifecycleStatus: 'active',
          visibility: 'public',
          updatedAt: '2026-08-11',
        },
        version: '1.0.0',
        files: [{ path: 'SKILL.md', content: '# Review\n' }],
      },
      resources: [],
    }),
    close: async () => undefined,
  };
}

describe('applyPlannedChange', () => {
  it('applies when the fingerprint matches and there are no conflicts', async () => {
    const outcome = await applyPlannedChange(
      'abc',
      false,
      { fingerprint: 'abc', conflicts: [] },
      async () => 'applied',
    );

    expect(outcome).toEqual({ stale: false, conflict: false, plan: { fingerprint: 'abc', conflicts: [] }, result: 'applied' });
  });

  it('rejects a stale fingerprint before applying', async () => {
    let applied = false;
    // SAFETY: A stale fingerprint returns the stale branch without the applied result, so the assertion narrows to the other members of ApplyOutcome.
    const outcome = await applyPlannedChange(
      'stale',
      false,
      { fingerprint: 'fresh', conflicts: [] },
      async () => {
        applied = true;
        return 'applied';
      },
    ) as ApplyOutcome<string>;

    expect(outcome).toEqual({ stale: true, conflict: false, plan: { fingerprint: 'fresh', conflicts: [] } });
    expect(applied).toBe(false);
  });

  it('reports conflicts and skips the apply without force', async () => {
    const outcome = await applyPlannedChange(
      'abc',
      false,
      { fingerprint: 'abc', conflicts: ['conflict'] },
      async () => 'applied',
    );

    expect(outcome).toEqual({ stale: false, conflict: true, plan: { fingerprint: 'abc', conflicts: ['conflict'] } });
  });

  it('applies conflicts when force is set', async () => {
    const outcome = await applyPlannedChange(
      'abc',
      true,
      { fingerprint: 'abc', conflicts: ['conflict'] },
      async () => 'applied',
    );

    expect(outcome).toMatchObject({ stale: false, conflict: false, result: 'applied' });
  });

  it('applies without a fingerprint', async () => {
    const outcome = await applyPlannedChange(
      undefined,
      false,
      { fingerprint: 'abc', conflicts: [] },
      async () => 'applied',
    );

    expect(outcome).toMatchObject({ result: 'applied' });
  });
});

describe('resolveOperations', () => {
  it('resolves file operations and attaches template packs', async () => {
    const operations: ChangeOperationData[] = [{
      resource: 'john-doe/skills/typescript-review',
      action: 'install',
      harnesses: ['codex'],
      force: false,
      installDependencies: false,
      removeDependencies: false,
    }];

    const resolved = await resolveOperations(operations, snapshot([]), false);

    expect(resolved).toEqual([{
      resource: 'john-doe/skills/typescript-review',
      action: 'install',
      harnesses: ['codex'],
      force: false,
      installDependencies: false,
      removeDependencies: false,
      resources: [],
      warningResources: [
        expect.objectContaining({ version: '1.0.0' }),
      ],
    }]);
  });

  it('resolves MCP operations with scope and uninstall resource IDs', async () => {
    const operations: ChangeOperationData[] = [{
      resource: 'john-doe/mcp-servers/github',
      action: 'uninstall',
      harnesses: ['opencode'],
      scope: 'project',
      force: false,
      installDependencies: false,
      removeDependencies: false,
    }];

    const resolved = await resolveOperations(operations, snapshot([]), true);

    expect(resolved[0]).toMatchObject({
      resource: 'john-doe/mcp-servers/github',
      action: 'uninstall',
      harnesses: ['opencode'],
      scope: 'project',
      resourceIds: [],
    });
  });
});

describe('changeOptions', () => {
  it('passes through home directory and environment', () => {
    expect(changeOptions(
      { homeDirectory: '/tmp/home', environment: { GITHUB_PAT: 'x' } },
      '/tmp/cwd',
    )).toEqual({ cwd: '/tmp/cwd', homeDirectory: '/tmp/home', environment: { GITHUB_PAT: 'x' } });
  });

  it('applies scope and dependency flags only when supplied', () => {
    expect(changeOptions({}, '/tmp/cwd', 'project', {
      installDependencies: true,
    })).toEqual({ cwd: '/tmp/cwd', scope: 'project', installDependencies: true });

    expect(changeOptions({}, '/tmp/cwd', 'project', {
      removeDependencies: true,
    })).toEqual({ cwd: '/tmp/cwd', scope: 'project', removeDependencies: true });
  });

  it('omits dependency options when undefined', () => {
    const options = changeOptions({}, '/tmp/cwd', 'project');
    expect('installDependencies' in options).toBe(false);
    expect('removeDependencies' in options).toBe(false);
  });
});
