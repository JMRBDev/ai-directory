import { describe, expect, it } from 'vitest';
import {
  changePlanError,
  parseChangeOperations,
  parseResourceRequest,
  requestError,
} from '../src/index.js';

describe('request validation', () => {
  it('accepts a minimal resource request and normalizes harnesses', () => {
    expect(parseResourceRequest({
      resource: 'john-doe/skills/typescript-review',
      harnesses: ['claude-code', 'codex', 'codex'],
    })).toMatchObject({
      resource: 'john-doe/skills/typescript-review',
      harnesses: ['claude-code', 'codex'],
      force: false,
      installDependencies: false,
      removeDependencies: false,
    });
  });

  it('accepts harnesses as a comma-separated string', () => {
    expect(parseResourceRequest({
      resource: 'john-doe/skills/typescript-review',
      harnesses: 'claude-code, opencode',
    }).harnesses).toEqual(['claude-code', 'opencode']);
  });

  it('rejects a resource request without harnesses', () => {
    expect(requestError({ resource: 'john-doe/skills/typescript-review' })).toBe(
      'harnesses must include one or more of claude-code, opencode, codex, pi.',
    );
  });

  it('rejects an unknown harness with a specific message', () => {
    expect(requestError({
      resource: 'john-doe/skills/typescript-review',
      harnesses: ['not-a-harness'],
    })).toBe('harnesses must include only claude-code, opencode, codex, pi.');
  });

  it('rejects an empty resource', () => {
    expect(requestError({ resource: '  ', harnesses: ['codex'] })).toBe(
      'resource must be a non-empty string.',
    );
  });

  it('rejects project scope for a non-MCP resource', () => {
    expect(requestError({
      resource: 'john-doe/skills/typescript-review',
      harnesses: ['codex'],
      scope: 'project',
    })).toBe('Project scope is only supported for MCP servers.');
  });

  it('accepts project scope for an MCP server', () => {
    expect(parseResourceRequest({
      resource: 'john-doe/mcp-servers/github',
      harnesses: ['opencode'],
      scope: 'project',
    }).scope).toBe('project');
  });

  it('rejects a non-boolean force flag', () => {
    expect(requestError({
      resource: 'john-doe/skills/typescript-review',
      harnesses: ['codex'],
      force: 'yes',
    })).toBe('force must be a boolean.');
  });
});

describe('change plan validation', () => {
  it('accepts a batch of operations', () => {
    expect(changePlanError({
      operations: [
        { resource: 'john-doe/skills/typescript-review', action: 'install', harnesses: ['codex'] },
        { resource: 'john-doe/skills/typescript-review', action: 'install', harnesses: ['opencode'] },
        { resource: 'jane-doe/agents/api-reviewer', action: 'uninstall', harnesses: ['claude-code'] },
      ],
    })).toBeNull();
  });

  it('rejects a plan without operations', () => {
    expect(changePlanError({ operations: [] })).toBe(
      'operations must include one or more resource changes.',
    );
  });

  it('rejects a non-object operation', () => {
    expect(changePlanError({ operations: ['install'] })).toBe(
      'Each operation must be a JSON object.',
    );
  });

  it('rejects an unknown action', () => {
    expect(changePlanError({
      operations: [{ resource: 'john-doe/skills/typescript-review', action: 'reinstall', harnesses: ['codex'] }],
    })).toBe('Each operation action must be install or uninstall.');
  });

  it('rejects a duplicate operation for the same harness and resource', () => {
    expect(changePlanError({
      operations: [
        { resource: 'john-doe/skills/typescript-review', action: 'install', harnesses: ['codex', 'opencode'] },
        { resource: 'john-doe/skills/typescript-review', action: 'install', harnesses: ['codex'] },
      ],
    })).toBe('The operation is listed more than once: codex:john-doe/skills/typescript-review.');
  });

  it('rejects a duplicate across uninstall and install with a shared harness', () => {
    expect(changePlanError({
      operations: [
        { resource: 'john-doe/skills/typescript-review', action: 'install', harnesses: ['codex'] },
        { resource: 'john-doe/skills/typescript-review', action: 'uninstall', harnesses: ['codex'] },
      ],
    })).toBe('The operation is listed more than once: codex:john-doe/skills/typescript-review.');
  });

  it('parses an operation into a typed change request', () => {
    expect(parseChangeOperations({
      operations: [{ resource: 'john-doe/mcp-servers/github', action: 'install', harnesses: ['opencode'], scope: 'project' }],
    }).operations).toEqual([{
      resource: 'john-doe/mcp-servers/github',
      action: 'install',
      harnesses: ['opencode'],
      scope: 'project',
      force: false,
      installDependencies: false,
      removeDependencies: false,
    }]);
  });

  it('rejects a plan that mixes project scope with a file resource', () => {
    expect(changePlanError({
      operations: [
        { resource: 'john-doe/skills/typescript-review', action: 'install', harnesses: ['codex'], scope: 'project' },
      ],
    })).toBe('Project scope is only supported for MCP servers.');
  });
});
