import { describe, expect, it } from 'vitest';
import {
  detectResourceRoots,
  harnessSchema,
  mcpServerManifestSchema,
  pluginManifestSchema,
  registryIndexSchema,
  resourceIdSchema,
  templateManifestSchema,
  toolManifestSchema,
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

describe('plugin manifest contract', () => {
  it('accepts a valid plugin manifest', () => {
    expect(
      pluginManifestSchema.parse({
        name: 'review-pack',
        description: 'A review pack.',
        version: '1.0.0',
      }),
    ).toMatchObject({ name: 'review-pack' });
  });

  it('passes through harness-specific fields', () => {
    expect(
      pluginManifestSchema.parse({
        name: 'review-pack',
        skills: './skills/',
        mcpServers: './.mcp.json',
      }),
    ).toMatchObject({ name: 'review-pack', skills: './skills/' });
  });

  it('rejects a manifest without a valid slug name', () => {
    expect(pluginManifestSchema.safeParse({ name: 'Not a slug' }).success).toBe(false);
  });
});

describe('tool manifest contract', () => {
  it('accepts a command-line tool manifest', () => {
    expect(
      toolManifestSchema.parse({
        name: 'rtk',
        description: 'Reduce shell output for agent workflows.',
        command: 'rtk',
        executables: ['bin/rtk'],
      }),
    ).toEqual({
      name: 'rtk',
      description: 'Reduce shell output for agent workflows.',
      command: 'rtk',
      executables: ['bin/rtk'],
    });
  });

  it('rejects shell syntax in a tool command', () => {
    expect(toolManifestSchema.safeParse({
      name: 'rtk',
      description: 'Reduce shell output.',
      command: 'rtk && rm -rf /',
    }).success).toBe(false);
  });

  it('rejects executable paths outside the resource bundle', () => {
    expect(toolManifestSchema.safeParse({
      name: 'rtk',
      description: 'Reduce shell output.',
      command: 'rtk',
      executables: ['../rtk'],
    }).success).toBe(false);
  });

  it('accepts structured runtime installers', () => {
    expect(toolManifestSchema.parse({
      name: 'semgrep',
      description: 'Find security patterns.',
      command: 'semgrep',
      runtime: {
        command: 'semgrep',
        minimumVersion: '1.0.0',
        installers: [
          { manager: 'homebrew', package: 'semgrep' },
          { manager: 'pipx', package: 'semgrep' },
        ],
        dependencies: [{
          command: 'jq',
          installers: [{ manager: 'homebrew', package: 'jq' }],
        }],
      },
    }).runtime).toEqual({
      command: 'semgrep',
      minimumVersion: '1.0.0',
      installers: [
        { manager: 'homebrew', package: 'semgrep' },
        { manager: 'pipx', package: 'semgrep' },
      ],
      dependencies: [{
        command: 'jq',
        installers: [{ manager: 'homebrew', package: 'jq' }],
      }],
    });
  });

  it('rejects runtime commands that differ from the tool command', () => {
    expect(toolManifestSchema.safeParse({
      name: 'semgrep',
      description: 'Find security patterns.',
      command: 'semgrep',
      runtime: {
        command: 'other-command',
        installers: [{ manager: 'homebrew', package: 'semgrep' }],
      },
    }).success).toBe(false);
  });

  it('rejects unsafe package names', () => {
    expect(toolManifestSchema.safeParse({
      name: 'semgrep',
      description: 'Find security patterns.',
      command: 'semgrep',
      runtime: {
        command: 'semgrep',
        installers: [{ manager: 'homebrew', package: 'semgrep && touch hacked' }],
      },
    }).success).toBe(false);
  });
});

describe('resource ID contract', () => {
  it('accepts owner, type, and name identifiers', () => {
    expect(resourceIdSchema.parse('john-doe/skills/typescript-review')).toBe(
      'john-doe/skills/typescript-review',
    );
  });

  it('accepts plugin resource identifiers', () => {
    expect(resourceIdSchema.parse('john-doe/plugins/review-pack')).toBe(
      'john-doe/plugins/review-pack',
    );
  });

  it('accepts tool resource identifiers', () => {
    expect(resourceIdSchema.parse('john-doe/tools/rtk')).toBe('john-doe/tools/rtk');
  });

  it('rejects malformed identifiers', () => {
    expect(resourceIdSchema.safeParse('John Doe/skills/my-skill').success).toBe(false);
  });
});

describe('detectResourceRoots', () => {
  it('detects an entry file at the selection root and uses the fallback name', () => {
    expect(detectResourceRoots(['SKILL.md', 'scripts/run.sh'], 'my-skill')).toEqual([
      { type: 'skills', entryFile: 'SKILL.md', root: '', name: 'my-skill' },
    ]);
  });

  it('detects nested resources of different types with folder-derived names', () => {
    expect(
      detectResourceRoots([
        'pack/skills/code-review/SKILL.md',
        'pack/agents/reviewer/AGENT.md',
        'pack/skills/code-review/scripts/lint.sh',
        'pack/README.md',
      ]),
    ).toEqual([
      { type: 'agents', entryFile: 'AGENT.md', root: 'pack/agents/reviewer', name: 'reviewer' },
      { type: 'skills', entryFile: 'SKILL.md', root: 'pack/skills/code-review', name: 'code-review' },
    ]);
  });

  it('detects plugin manifests from both harness directories and dedupes the root', () => {
    const claudeOnly = detectResourceRoots(['bundle/.claude-plugin/plugin.json']);
    expect(claudeOnly).toEqual([
      { type: 'plugins', entryFile: '.claude-plugin/plugin.json', root: 'bundle', name: 'bundle' },
    ]);
    expect(detectResourceRoots(['bundle/.codex-plugin/plugin.json'])).toEqual([
      { type: 'plugins', entryFile: '.codex-plugin/plugin.json', root: 'bundle', name: 'bundle' },
    ]);

    const both = detectResourceRoots([
      'bundle/.claude-plugin/plugin.json',
      'bundle/.codex-plugin/plugin.json',
    ]);
    expect(both).toHaveLength(1);
  });

  it('normalizes Windows separators and ignores files that are not entries', () => {
    expect(detectResourceRoots(['pack\\tools\\deployer\\TOOL.md'])).toEqual([
      { type: 'tools', entryFile: 'TOOL.md', root: 'pack/tools/deployer', name: 'deployer' },
    ]);
    expect(detectResourceRoots(['notes/SKILLS.md', 'deep/AGENT.md.bak'])).toEqual([]);
  });
});

describe('harness contract', () => {
  it('accepts all supported harnesses', () => {
    expect(harnessSchema.options).toEqual(['claude-code', 'opencode', 'codex', 'pi']);
    expect(harnessSchema.parse('pi')).toBe('pi');
    expect(harnessSchema.safeParse('unknown').success).toBe(false);
  });
});
