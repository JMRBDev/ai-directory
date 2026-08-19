import { describe, expect, it } from 'vitest';
import type { ChangePlan, StagedItem } from '../src/lib/types';
import {
  activeResourceType,
  groupStaged,
  hasApplyableOperation,
  installScope,
  mergePlans,
  operationsFor,
  resourceType,
} from '../src/features/directory/model';

const skill: StagedItem = {
  key: 'jane-doe/skills/review',
  resource: 'jane-doe/skills/review',
  type: 'skills',
  action: 'install',
  harnesses: ['claude-code'],
};

const server: StagedItem = {
  key: 'jane-doe/mcp-servers/github',
  resource: 'jane-doe/mcp-servers/github',
  type: 'mcp-servers',
  action: 'uninstall',
  harnesses: [],
};

describe('directory model', () => {
  it('selects the first populated catalog type after registry loading', () => {
    expect(activeResourceType([{ type: 'agents' }])).toBe('agents');
    expect(activeResourceType([{ type: 'agents' }], 'rules')).toBe('rules');
    expect(activeResourceType([])).toBe('skills');
  });

  it('normalizes invalid select values to safe defaults', () => {
    expect(resourceType('agents')).toBe('agents');
    expect(resourceType('unknown')).toBe('skills');
    expect(installScope('project')).toBe('project');
    expect(installScope('unknown')).toBe('user');
  });

  it('groups staged resources and applies MCP fallback scope', () => {
    expect(groupStaged([skill, server]).map((group) => [group.name, group.items])).toEqual([
      ['mcp', [server]],
      ['files', [skill]],
    ]);
    expect(operationsFor([server], ['codex'], 'project')).toEqual([{
      resource: server.resource,
      action: 'uninstall',
      harnesses: ['codex'],
      scope: 'project',
    }]);
  });

  it('merges plans and detects file or uninstall operations', () => {
    const first: ChangePlan = {
      operations: [{ resource: skill.resource, action: skill.action, harnesses: skill.harnesses }],
      changes: [{ resource: skill.resource, harness: 'claude-code', action: 'added', path: 'SKILL.md', after: '# Review' }],
      conflicts: ['skill conflict'],
      warnings: ['skill warning'],
      projectionNotes: ['skill note'],
      dependencyRemovals: [],
      fingerprint: 'first',
    };
    const second: ChangePlan = {
      operations: [{ resource: server.resource, action: server.action, harnesses: ['codex'] }],
      changes: [],
      conflicts: ['skill conflict'],
      warnings: ['server warning'],
      projectionNotes: [],
      dependencyRemovals: [{ command: 'unused-tool', manager: 'npm', package: 'unused-package', resources: [server.resource], uninstallCommand: 'npm uninstall unused-package' }],
      fingerprint: 'second',
    };

    expect(hasApplyableOperation(first)).toBe(true);
    expect(hasApplyableOperation(second)).toBe(true);
    expect(mergePlans([first, second])).toMatchObject({
      operations: [...first.operations, ...second.operations],
      conflicts: ['skill conflict'],
      warnings: ['skill warning', 'server warning'],
      projectionNotes: ['skill note'],
      dependencyRemovals: second.dependencyRemovals,
      fingerprint: '',
    });
  });
});
