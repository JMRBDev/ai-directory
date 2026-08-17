import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ResourceVersion } from '@ai-directory/registry';
import {
  applyMcpOperations,
  planMcpOperations,
  readInstallationManifest,
} from '../src/index.js';

const MCP_ENTRY = `---
name: github
description: GitHub MCP server for repository workflows.
transport: http
url: https://api.githubcopilot.com/mcp/
headers:
  Authorization: "Bearer {env:GITHUB_PAT}"
env:
  - name: GITHUB_PAT
    required: true
---

# GitHub MCP
`;

const STDPIO_ENTRY = `---
name: db
description: Database MCP server.
transport: stdio
command: npx
args:
  - "-y"
  - "@bytebase/dbhub"
env:
  - name: DATABASE_URL
    required: true
---

# Database MCP
`;

function mcpResource(entry: string, name = 'github'): ResourceVersion {
  return {
    resource: {
      owner: 'jose-rosendo',
      type: 'mcp-servers',
      name,
      description: 'An MCP server.',
      latestVersion: '1.0.0',
      reviewStatus: 'reviewed',
      lifecycleStatus: 'active',
      visibility: 'public',
      updatedAt: '2026-08-11',
    },
    version: '1.0.0',
    files: [{ path: 'MCP.md', content: entry }],
  };
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ai-directory-installers-'));
  temporaryDirectories.push(directory);
  return directory;
}

function projectOptions(directory: string) {
  return {
    cwd: directory,
    homeDirectory: join(directory, 'home'),
    environment: { GITHUB_PAT: 'test-token', DATABASE_URL: 'postgres://localhost/app' },
  };
}

describe('MCP server installation', () => {
  it.each([
    ['claude-code', '.mcp.json', (content: string) => expect(content).toContain('"Authorization": "Bearer ${GITHUB_PAT}"')],
    ['opencode', 'opencode.json', (content: string) => expect(content).toContain('"Authorization": "Bearer {env:GITHUB_PAT}"')],
    ['codex', '.codex/config.toml', (content: string) => expect(content).toContain('bearer_token_env_var = "GITHUB_PAT"')],
  ] as const)('writes a project-scoped %s entry to its config file', async (harness, configPath, assertEntry) => {
    const directory = await createTemporaryDirectory();
    const applied = await applyMcpOperations(
      [{
        resource: 'jose-rosendo/mcp-servers/github',
        harnesses: [harness],
        action: 'install',
        resources: [mcpResource(MCP_ENTRY)],
        scope: 'project',
      }],
      projectOptions(directory),
    );

    const content = await readFile(join(directory, configPath), 'utf8');
    assertEntry(content);

    expect(applied.installed).toHaveLength(1);
    expect(applied.installed[0]).toMatchObject({
      resource: 'jose-rosendo/mcp-servers/github',
      harness,
      kind: 'mcp',
      scope: 'project',
    });

    const manifest = await readInstallationManifest(
      join(directory, '.ai-directory', 'installed.json'),
    );
    expect(manifest.installations).toHaveLength(1);
  });

  it.each(['claude-code', 'opencode', 'codex'] as const)(
    'passes stdio env vars through for %s',
    async (harness) => {
      const directory = await createTemporaryDirectory();
      await applyMcpOperations(
        [{
          resource: 'jose-rosendo/mcp-servers/db',
          harnesses: [harness],
          action: 'install',
          resources: [mcpResource(STDPIO_ENTRY, 'db')],
          scope: 'project',
        }],
        projectOptions(directory),
      );

      if (harness === 'claude-code') {
        const content = await readFile(join(directory, '.mcp.json'), 'utf8');
        expect(content).toContain('"DATABASE_URL": "${DATABASE_URL}"');
      } else if (harness === 'opencode') {
        const content = await readFile(join(directory, 'opencode.json'), 'utf8');
        expect(content).toContain('"DATABASE_URL": "{env:DATABASE_URL}"');
        expect(content).toContain('"type": "local"');
        expect(content).toContain('"@bytebase/dbhub"');
      } else {
        const content = await readFile(join(directory, '.codex', 'config.toml'), 'utf8');
        expect(content).toContain('env_vars = [ "DATABASE_URL" ]');
        expect(content).toContain('args = [ "-y", "@bytebase/dbhub" ]');
      }
    },
  );

  it('uninstalls the managed entry from the config file', async () => {
    const directory = await createTemporaryDirectory();
    const options = projectOptions(directory);

    await applyMcpOperations(
      [{
        resource: 'jose-rosendo/mcp-servers/github',
        harnesses: ['claude-code'],
        action: 'install',
        resources: [mcpResource(MCP_ENTRY)],
        scope: 'project',
      }],
      options,
    );

    const applied = await applyMcpOperations(
      [{
        resource: 'jose-rosendo/mcp-servers/github',
        harnesses: ['claude-code'],
        action: 'uninstall',
        resourceIds: ['jose-rosendo/mcp-servers/github'],
        scope: 'project',
      }],
      options,
    );

    expect(applied.removed).toHaveLength(1);
    const content = await readFile(join(directory, '.mcp.json'), 'utf8');
    expect(content).not.toContain('github');

    const manifest = await readInstallationManifest(
      join(directory, '.ai-directory', 'installed.json'),
    );
    expect(manifest.installations).toHaveLength(0);
  });

  it('refuses to overwrite an entry that is not owned by an installation', async () => {
    const directory = await createTemporaryDirectory();
    const configPath = join(directory, '.mcp.json');
    await writeFile(configPath, JSON.stringify({ mcpServers: { github: { type: 'http', url: 'https://other.example.com/mcp' } } }, null, 2));

    const plan = await planMcpOperations(
      [{
        resource: 'jose-rosendo/mcp-servers/github',
        harnesses: ['claude-code'],
        action: 'install',
        resources: [mcpResource(MCP_ENTRY)],
        scope: 'project',
      }],
      projectOptions(directory),
    );

    expect(plan.conflicts.join(' ')).toContain('already exists');
  });

  it('replaces an owned entry on update', async () => {
    const directory = await createTemporaryDirectory();
    const options = projectOptions(directory);

    await applyMcpOperations(
      [{
        resource: 'jose-rosendo/mcp-servers/github',
        harnesses: ['opencode'],
        action: 'install',
        resources: [mcpResource(MCP_ENTRY)],
        scope: 'project',
      }],
      options,
    );

    const updated = MCP_ENTRY.replace('https://api.githubcopilot.com/mcp/', 'https://insiders.example.com/mcp');
    const applied = await applyMcpOperations(
      [{
        resource: 'jose-rosendo/mcp-servers/github',
        harnesses: ['opencode'],
        action: 'install',
        resources: [{ ...mcpResource(updated), version: '1.1.0' }],
        scope: 'project',
      }],
      options,
    );

    expect(applied.installed[0]?.version).toBe('1.1.0');
    const content = await readFile(join(directory, 'opencode.json'), 'utf8');
    expect(content).toContain('https://insiders.example.com/mcp');
    expect(content).not.toContain('api.githubcopilot.com');
  });

  it('reports missing required environment variables with instructions', async () => {
    const directory = await createTemporaryDirectory();
    const plan = await planMcpOperations(
      [{
        resource: 'jose-rosendo/mcp-servers/github',
        harnesses: ['opencode'],
        action: 'install',
        resources: [mcpResource(MCP_ENTRY)],
        scope: 'project',
      }],
      { cwd: directory, homeDirectory: join(directory, 'home'), environment: {} },
    );

    expect(plan.envNotes.join('\n')).toContain('GITHUB_PAT');
    expect(plan.envNotes.join('\n')).toContain('export GITHUB_PAT=...');

    const applied = await applyMcpOperations(
      [{
        resource: 'jose-rosendo/mcp-servers/github',
        harnesses: ['opencode'],
        action: 'install',
        resources: [mcpResource(MCP_ENTRY)],
        scope: 'project',
      }],
      { cwd: directory, homeDirectory: join(directory, 'home'), environment: {} },
    );

    expect(applied.warnings.join('\n')).toContain('GITHUB_PAT');
  });

  it('does not warn about optional env vars on remote servers', async () => {
    const directory = await createTemporaryDirectory();
    const optionalEntry = `---
name: context7
description: Docs search.
transport: http
url: https://mcp.context7.com/mcp
headers:
  CONTEXT7_API_KEY: "{env:CONTEXT7_API_KEY}"
env:
  - name: CONTEXT7_API_KEY
    required: false
---

# Context7
`;
    const plan = await planMcpOperations(
      [{
        resource: 'jose-rosendo/mcp-servers/context7',
        harnesses: ['opencode'],
        action: 'install',
        resources: [mcpResource(optionalEntry, 'context7')],
        scope: 'project',
      }],
      { cwd: directory, homeDirectory: join(directory, 'home'), environment: {} },
    );

    expect(plan.envNotes.join('\n')).not.toContain('CONTEXT7_API_KEY');
  });

  it('rejects a server name reserved by Claude Code', async () => {
    const directory = await createTemporaryDirectory();
    const reservedEntry = MCP_ENTRY.replace('name: github', 'name: computer-use');
    const reserved = mcpResource(reservedEntry, 'computer-use');

    await expect(
      applyMcpOperations(
        [{
          resource: 'jose-rosendo/mcp-servers/computer-use',
          harnesses: ['claude-code'],
          action: 'install',
          resources: [reserved],
          scope: 'project',
        }],
        projectOptions(directory),
      ),
    ).rejects.toThrow('reserved by Claude Code');
  });

  it('preserves unrelated content when editing Codex config.toml', async () => {
    const directory = await createTemporaryDirectory();
    const configPath = join(directory, '.codex', 'config.toml');
    await mkdir(join(directory, '.codex'), { recursive: true });
    const original = `# my notes\nmodel = "gpt-5.1"\n\n[history]\npersistence = "save-all"\n`;
    await writeFile(configPath, original);

    const options = projectOptions(directory);
    await applyMcpOperations(
      [{
        resource: 'jose-rosendo/mcp-servers/github',
        harnesses: ['codex'],
        action: 'install',
        resources: [mcpResource(MCP_ENTRY)],
        scope: 'project',
      }],
      options,
    );

    await applyMcpOperations(
      [{
        resource: 'jose-rosendo/mcp-servers/github',
        harnesses: ['codex'],
        action: 'uninstall',
        resourceIds: ['jose-rosendo/mcp-servers/github'],
        scope: 'project',
      }],
      options,
    );

    const content = await readFile(configPath, 'utf8');
    expect(content).toContain('# my notes');
    expect(content).toContain('model = "gpt-5.1"');
    expect(content).toContain('[history]');
    expect(content).not.toContain('mcp_servers');
  });
});