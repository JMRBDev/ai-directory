import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resourceKey } from '@ai-directory/contracts';
import type { ResourceVersion } from '@ai-directory/registry';
import {
  applyResourceOperations,
  createInstallationRecords,
  discoverLocalResources,
  enrichLocalResources,
  installClaudeCodeResources,
  installCodexResources,
  installOpenCodeResources,
  getHarnessAdapter,
  openCodeInstaller,
  planResourceOperations,
  readInstallationManifest,
  removeStaleInstallationFiles,
  uninstallInstallation,
  updateInstallationManifest,
  type InstallationRecord,
} from '../src/index.js';

const resource = {
  resource: {
    owner: 'jose-rosendo',
    type: 'skills',
    name: 'typescript-api-review',
    description: 'Review a TypeScript API before it ships.',
    latestVersion: '1.0.0',
    reviewStatus: 'unreviewed',
    lifecycleStatus: 'active',
    visibility: 'public',
    updatedAt: '2026-08-11',
  },
  version: '1.0.0',
  files: [
    { path: 'SKILL.md', content: '# API review\n' },
    { path: 'references/checklist.md', content: '- Check errors\n' },
  ],
} satisfies ResourceVersion;

const resourceWithCodexMetadata = {
  ...resource,
  files: [
    ...resource.files,
    { path: 'agents/openai.yaml', content: 'interface:\n  display_name: "API review"\n' },
  ],
} satisfies ResourceVersion;

const agentResource = {
  ...resource,
  resource: {
    ...resource.resource,
    type: 'agents',
    name: 'api-reviewer',
  },
  files: [
    { path: 'AGENT.md', content: '# API reviewer\n' },
    { path: 'references/checklist.md', content: '- Check errors\n' },
  ],
} satisfies ResourceVersion;

const ruleResource = {
  ...resource,
  resource: {
    ...resource.resource,
    type: 'rules',
    name: 'typescript-quality',
  },
  files: [
    { path: 'RULE.md', content: '# TypeScript quality\n' },
    { path: 'references/examples.md', content: '- Prefer narrow types\n' },
  ],
} satisfies ResourceVersion;

const pluginResource = {
  ...resource,
  resource: {
    ...resource.resource,
    type: 'plugins',
    name: 'review-pack',
  },
  files: [
    {
      path: '.claude-plugin/plugin.json',
      content: '{"name":"review-pack","description":"A review pack.","version":"1.0.0"}\n',
    },
    { path: 'skills/reviewer/SKILL.md', content: '# Reviewer\n' },
    { path: '.opencode/plugin.ts', content: 'export const ReviewPack = async () => ({})\n' },
  ],
} satisfies ResourceVersion;

const toolResource = {
  ...resource,
  resource: {
    ...resource.resource,
    type: 'tools',
    name: 'rtk',
  },
  files: [
    {
      path: 'TOOL.md',
      content: '---\nname: rtk\ndescription: Reduce shell output.\ncommand: rtk\nexecutables:\n  - bin/rtk\n---\n# RTK\n',
    },
    {
      path: '.claude-plugin/plugin.json',
      content: '{"name":"rtk","description":"Reduce shell output."}\n',
    },
    {
      path: '.codex-plugin/plugin.json',
      content: '{"name":"rtk","description":"Reduce shell output."}\n',
    },
    { path: '.opencode/plugin.ts', content: 'export const RTK = async () => ({})\n' },
    { path: '.opencode/tools/rtk.ts', content: 'export const tool = {}\n' },
    { path: 'bin/rtk', content: '#!/bin/sh\nprintf "rtk\\n"\n' },
  ],
} satisfies ResourceVersion;

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('installClaudeCodeResources', () => {
  it('installs a skill in the global Claude Code directory', async () => {
    const homeDirectory = await createTemporaryDirectory();

    const [result] = await installClaudeCodeResources([resource], {
      homeDirectory,
    });

    expect(result).toMatchObject({
      destination: join(homeDirectory, '.claude', 'skills', 'typescript-api-review'),
    });
    await expect(readFile(join(result.destination, 'SKILL.md'), 'utf8')).resolves.toBe(
      '# API review\n',
    );
    await expect(
      readFile(join(result.destination, 'references', 'checklist.md'), 'utf8'),
    ).resolves.toBe('- Check errors\n');
  });

  it('refuses accidental overwrites and honors force', async () => {
    const homeDirectory = await createTemporaryDirectory();

    await installClaudeCodeResources([resource], {
      homeDirectory,
    });

    await expect(
      installClaudeCodeResources([resource], {
        homeDirectory,
      }),
    ).rejects.toThrow('Use --force to overwrite.');

    const [result] = await installClaudeCodeResources([resource], {
      homeDirectory,
      force: true,
    });
    expect(result).toMatchObject({
      destination: join(homeDirectory, '.claude', 'skills', 'typescript-api-review'),
    });
  });

  it('installs agents and rules as Claude Code flat files', async () => {
    const homeDirectory = await createTemporaryDirectory();

    const [agentResult, ruleResult] = await installClaudeCodeResources(
      [agentResource, ruleResource],
      { homeDirectory },
    );

    expect(agentResult.destination).toBe(
      join(homeDirectory, '.claude', 'agents', 'api-reviewer.md'),
    );
    expect(ruleResult.destination).toBe(
      join(homeDirectory, '.claude', 'rules', 'typescript-quality.md'),
    );
    await expect(readFile(agentResult.destination, 'utf8')).resolves.toBe('# API reviewer\n');
    await expect(readFile(ruleResult.destination, 'utf8')).resolves.toBe(
      '# TypeScript quality\n',
    );
    await expect(
      readFile(
        join(
          homeDirectory,
          '.claude',
          'agents',
          'api-reviewer.files',
          'references',
          'checklist.md',
        ),
        'utf8',
      ),
    ).resolves.toBe('- Check errors\n');
    await expect(
      readFile(
        join(
          homeDirectory,
          '.claude',
          'rules',
          'typescript-quality.files',
          'references',
          'examples.md',
        ),
        'utf8',
      ),
    ).resolves.toBe('- Prefer narrow types\n');
  });

  it('checks a batch before writing files', async () => {
    const homeDirectory = await createTemporaryDirectory();

    await installClaudeCodeResources([resource], {
      homeDirectory,
    });

    await expect(
      installClaudeCodeResources([resource, agentResource], {
        homeDirectory,
      }),
    ).rejects.toThrow('Use --force to overwrite.');

    await expect(
      readFile(join(homeDirectory, '.claude', 'agents', 'api-reviewer.md'), 'utf8'),
    ).rejects.toThrow();
  });

  it('rejects overlapping batch destinations even with force', async () => {
    const homeDirectory = await createTemporaryDirectory();

    await expect(
      installClaudeCodeResources([resource, resource], {
        homeDirectory,
        force: true,
      }),
    ).rejects.toThrow('Install resources overlap');
  });

  it('does not install templates as standalone Claude Code resources', async () => {
    const homeDirectory = await createTemporaryDirectory();
    const templateResource = {
      ...resource,
      resource: {
        ...resource.resource,
        type: 'templates',
        name: 'backend-review-pack',
      },
      files: [{ path: 'TEMPLATE.md', content: '# Backend review pack\n' }],
    } satisfies ResourceVersion;

    await expect(
      installClaudeCodeResources([templateResource], {
        homeDirectory,
      }),
    ).rejects.toThrow('Templates must be expanded first.');
  });

  it('rejects files that escape the resource directory', async () => {
    const homeDirectory = await createTemporaryDirectory();
    const unsafeResource = {
      ...resource,
      files: [{ path: '../outside.md', content: 'unsafe\n' }],
    } satisfies ResourceVersion;

    await expect(
      installClaudeCodeResources([unsafeResource], {
        homeDirectory,
      }),
    ).rejects.toThrow('Unsafe resource file path');
  });
});

describe('local resource discovery', () => {
  it('finds unmanaged skills, agents, and rules in global harness locations', async () => {
    const homeDirectory = await createTemporaryDirectory();

    await mkdir(join(homeDirectory, '.claude', 'skills', 'local-skill'), { recursive: true });
    await writeFile(
      join(homeDirectory, '.claude', 'skills', 'local-skill', 'SKILL.md'),
      '# Local skill\n',
      'utf8',
    );
    await mkdir(join(homeDirectory, '.config', 'opencode', 'agents'), { recursive: true });
    await writeFile(
      join(homeDirectory, '.config', 'opencode', 'agents', 'local-agent.md'),
      '# Local agent\n',
      'utf8',
    );
    await mkdir(join(homeDirectory, '.ai-directory', 'rules'), { recursive: true });
    await writeFile(
      join(homeDirectory, '.ai-directory', 'rules', 'local-rule.md'),
      '# Local rule\n',
      'utf8',
    );

    const resources = await discoverLocalResources({
      homeDirectory,
      environment: { PATH: '' },
    });

    expect(resources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'skills',
        name: 'local-skill',
        harness: 'claude-code',
        state: 'unmanaged',
      }),
      expect.objectContaining({
        type: 'agents',
        name: 'local-agent',
        harness: 'opencode',
        state: 'unmanaged',
      }),
      expect.objectContaining({
        type: 'rules',
        name: 'local-rule',
        harness: 'codex',
        state: 'unmanaged',
      }),
    ]));
  });

  it('reports managed resources as current, modified, or missing', async () => {
    const homeDirectory = await createTemporaryDirectory();
    const [installation] = await installClaudeCodeResources([resource], {
      homeDirectory,
    });
    const [record] = createInstallationRecords(
      [resource],
      [installation],
      'claude-code',
    );

    await expect(
      discoverLocalResources({ homeDirectory, records: [record] }),
    ).resolves.toEqual([
      expect.objectContaining({
        resource: resourceKey(resource.resource),
        state: 'managed',
        version: '1.0.0',
      }),
    ]);

    await writeFile(join(installation.destination, 'SKILL.md'), '# Changed locally\n', 'utf8');
    await expect(
      discoverLocalResources({ homeDirectory, records: [record] }),
    ).resolves.toEqual([
      expect.objectContaining({ state: 'modified' }),
    ]);

    await rm(installation.destination, { recursive: true, force: true });
    await expect(
      discoverLocalResources({ homeDirectory, records: [record] }),
    ).resolves.toEqual([
      expect.objectContaining({ state: 'missing' }),
    ]);
  });

  it('enriches managed resources with registry freshness', async () => {
    const homeDirectory = await createTemporaryDirectory();
    const [installation] = await installClaudeCodeResources([resource], {
      homeDirectory,
    });
    const [record] = createInstallationRecords(
      [resource],
      [installation],
      'claude-code',
    );
    const discovered = await discoverLocalResources({
      homeDirectory,
      records: [record],
    });

    expect(enrichLocalResources(discovered, {
      schemaVersion: 1,
      resources: [{ ...resource.resource, latestVersion: '1.2.0' }],
    })).toEqual([
      expect.objectContaining({
        registryState: 'outdated',
        latestVersion: '1.2.0',
      }),
    ]);
    expect(enrichLocalResources(discovered, null)).toEqual([
      expect.objectContaining({ registryState: 'unknown' }),
    ]);
  });
});

describe('portable harness installers', () => {
  it('exposes the harness capability matrix', () => {
    expect(getHarnessAdapter('claude-code').capabilities).toEqual({
      skills: 'native',
      agents: 'native',
      rules: 'native',
      'mcp-servers': 'configured',
      plugins: 'native',
      tools: 'native',
    });
    expect(getHarnessAdapter('opencode').capabilities).toEqual({
      skills: 'native',
      agents: 'translated',
      rules: 'configured',
      'mcp-servers': 'configured',
      plugins: 'native',
      tools: 'native',
    });
    expect(getHarnessAdapter('codex').capabilities).toEqual({
      skills: 'native',
      agents: 'translated',
      rules: 'configured',
      'mcp-servers': 'configured',
      plugins: 'configured',
      tools: 'configured',
    });
  });

  it('installs native OpenCode skills and agents', async () => {
    const homeDirectory = await createTemporaryDirectory();

    const [skillResult, agentResult] = await installOpenCodeResources(
      [resource, agentResource],
      { homeDirectory },
    );

    expect(skillResult.destination).toBe(
      join(homeDirectory, '.config', 'opencode', 'skills', 'typescript-api-review'),
    );
    expect(agentResult.destination).toBe(
      join(homeDirectory, '.config', 'opencode', 'agents', 'api-reviewer.md'),
    );
    await expect(readFile(join(skillResult.destination, 'SKILL.md'), 'utf8')).resolves.toBe(
      '# API review\n',
    );
    await expect(readFile(agentResult.destination, 'utf8')).resolves.toContain(
      'mode: subagent',
    );
    await expect(readFile(agentResult.destination, 'utf8')).resolves.toContain(
      '# API reviewer\n',
    );
  });

  it('projects Codex metadata only into Codex skills', async () => {
    const homeDirectory = await createTemporaryDirectory();

    const [claudeResult] = await installClaudeCodeResources(
      [resourceWithCodexMetadata],
      { homeDirectory },
    );
    const [openCodeResult] = await installOpenCodeResources(
      [resourceWithCodexMetadata],
      { homeDirectory },
    );
    const [codexResult] = await installCodexResources(
      [resourceWithCodexMetadata],
      { homeDirectory },
    );

    expect(claudeResult.files).not.toContain('agents/openai.yaml');
    expect(openCodeResult.files).not.toContain('agents/openai.yaml');
    expect(codexResult.files).toContain('agents/openai.yaml');
    expect(claudeResult.skippedFiles).toEqual(['agents/openai.yaml']);
    expect(openCodeResult.skippedFiles).toEqual(['agents/openai.yaml']);
    expect(codexResult.skippedFiles).toEqual([]);
    await expect(
      readFile(join(homeDirectory, '.claude', 'skills', 'typescript-api-review', 'agents', 'openai.yaml'), 'utf8'),
    ).rejects.toThrow();
    await expect(
      readFile(join(homeDirectory, '.config', 'opencode', 'skills', 'typescript-api-review', 'agents', 'openai.yaml'), 'utf8'),
    ).rejects.toThrow();
    await expect(
      readFile(join(homeDirectory, '.agents', 'skills', 'typescript-api-review', 'agents', 'openai.yaml'), 'utf8'),
    ).resolves.toContain('API review');
  });

  it('installs native Codex skills and converts agents to TOML', async () => {
    const homeDirectory = await createTemporaryDirectory();

    const [skillResult, agentResult] = await installCodexResources(
      [resource, agentResource],
      { homeDirectory },
    );

    expect(skillResult.destination).toBe(
      join(homeDirectory, '.agents', 'skills', 'typescript-api-review'),
    );
    expect(agentResult.destination).toBe(
      join(homeDirectory, '.codex', 'agents', 'api-reviewer.toml'),
    );
    await expect(readFile(join(skillResult.destination, 'SKILL.md'), 'utf8')).resolves.toBe(
      '# API review\n',
    );
    await expect(readFile(agentResult.destination, 'utf8')).resolves.toContain(
      'name = "api-reviewer"',
    );
    await expect(readFile(agentResult.destination, 'utf8')).resolves.toContain(
      'developer_instructions = "# API reviewer\\n"',
    );
  });

  it('uses the documented global directories', async () => {
    const homeDirectory = await createTemporaryDirectory();

    const [openCodeResult] = await installOpenCodeResources([resource], {
      homeDirectory,
    });
    const [codexResult] = await installCodexResources([agentResource], {
      homeDirectory,
    });

    expect(openCodeResult.destination).toBe(
      join(homeDirectory, '.config', 'opencode', 'skills', 'typescript-api-review'),
    );
    expect(codexResult.destination).toBe(
      join(homeDirectory, '.codex', 'agents', 'api-reviewer.toml'),
    );

    const [ruleResult] = await installOpenCodeResources([ruleResource], {
      homeDirectory,
    });

    expect(ruleResult.destination).toBe(
      join(homeDirectory, '.config', 'opencode', 'rules', 'typescript-quality.md'),
    );
    await expect(
      readFile(join(homeDirectory, '.config', 'opencode', 'opencode.json'), 'utf8'),
    ).resolves.toContain('rules/typescript-quality.md');
  });

  it('installs OpenCode rules and preserves JSONC configuration', async () => {
    const homeDirectory = await createTemporaryDirectory();
    const configPath = join(homeDirectory, '.config', 'opencode', 'opencode.jsonc');
    await mkdir(join(homeDirectory, '.config', 'opencode'), { recursive: true });
    await writeFile(
      configPath,
      '{\n  // Keep this setting.\n  "instructions": ["README.md"]\n}\n',
      'utf8',
    );

    const [result] = await installOpenCodeResources([ruleResource], {
      homeDirectory,
    });

    expect(result.destination).toBe(
      join(homeDirectory, '.config', 'opencode', 'rules', 'typescript-quality.md'),
    );
    await expect(readFile(result.destination, 'utf8')).resolves.toBe(
      '# TypeScript quality\n',
    );
    await expect(
      readFile(
        join(
          homeDirectory,
          '.config',
          'opencode',
          'rules',
          'typescript-quality.files',
          'references',
          'examples.md',
        ),
        'utf8',
      ),
    ).resolves.toBe('- Prefer narrow types\n');

    const config = await readFile(configPath, 'utf8');
    expect(config).toContain('// Keep this setting.');
    expect(config).toContain('"README.md"');
    expect(config).toContain('rules/typescript-quality.md');

    const updatedRule = {
      ...ruleResource,
      version: '1.1.0',
      files: [{ path: 'RULE.md', content: '# Updated TypeScript quality\n' }],
    } satisfies ResourceVersion;

    await installOpenCodeResources([updatedRule], {
      homeDirectory,
      force: true,
    });

    await expect(readFile(result.destination, 'utf8')).resolves.toBe(
      '# Updated TypeScript quality\n',
    );
    const updatedConfig = await readFile(configPath, 'utf8');
    expect(updatedConfig.split('rules/typescript-quality.md')).toHaveLength(2);
  });

  it('installs Codex rules in managed AGENTS blocks', async () => {
    const homeDirectory = await createTemporaryDirectory();
    const agentsPath = join(homeDirectory, '.codex', 'AGENTS.md');
    await mkdir(join(homeDirectory, '.codex'), { recursive: true });
    await writeFile(agentsPath, '# Existing guidance\n\nKeep this content.\n', 'utf8');

    const [result] = await installCodexResources([ruleResource], {
      homeDirectory,
    });

    expect(result.destination).toBe(agentsPath);
    await expect(
      readFile(
        join(homeDirectory, '.ai-directory', 'rules', 'typescript-quality.md'),
        'utf8',
      ),
    ).resolves.toBe('# TypeScript quality\n');

    const agents = await readFile(agentsPath, 'utf8');
    expect(agents).toContain('# Existing guidance');
    expect(agents).toContain('<!-- ai-directory:rule:jose-rosendo/rules/typescript-quality -->');
    expect(agents).toContain('# TypeScript quality');

    const updatedRule = {
      ...ruleResource,
      version: '1.1.0',
      files: [{ path: 'RULE.md', content: '# Updated TypeScript quality\n' }],
    } satisfies ResourceVersion;

    await installCodexResources([updatedRule], {
      homeDirectory,
      force: true,
    });

    const updatedAgents = await readFile(agentsPath, 'utf8');
    expect(updatedAgents).toContain('# Updated TypeScript quality');
    expect(updatedAgents).not.toContain('# TypeScript quality\n');
    expect(
      updatedAgents.split('<!-- ai-directory:rule:jose-rosendo/rules/typescript-quality -->'),
    ).toHaveLength(2);
  });

  it('uninstalls OpenCode rules without removing other instructions', async () => {
    const homeDirectory = await createTemporaryDirectory();
    const configPath = join(homeDirectory, '.config', 'opencode', 'opencode.json');
    await mkdir(join(homeDirectory, '.config', 'opencode'), { recursive: true });
    await writeFile(configPath, '{"instructions":["README.md"]}\n', 'utf8');

    const [result] = await installOpenCodeResources([ruleResource], {
      homeDirectory,
    });
    const record = {
      resource: resourceKey(ruleResource.resource),
      version: ruleResource.version,
      harness: 'opencode',
      destination: result.destination,
      files: result.ownedPaths,
      fileHashes: result.fileHashes,
      installedAt: new Date().toISOString(),
    } satisfies InstallationRecord;

    await uninstallInstallation(record, { homeDirectory });

    await expect(readFile(result.destination, 'utf8')).rejects.toThrow();
    await expect(readFile(configPath, 'utf8')).resolves.not.toContain(
      'rules/typescript-quality.md',
    );
    await expect(readFile(configPath, 'utf8')).resolves.toContain('README.md');
  });

  it('uninstalls Codex rules without removing existing guidance', async () => {
    const homeDirectory = await createTemporaryDirectory();
    const agentsPath = join(homeDirectory, '.codex', 'AGENTS.md');
    await mkdir(join(homeDirectory, '.codex'), { recursive: true });
    await writeFile(agentsPath, '# Existing guidance\n', 'utf8');

    const [result] = await installCodexResources([ruleResource], {
      homeDirectory,
    });
    const record = {
      resource: resourceKey(ruleResource.resource),
      version: ruleResource.version,
      harness: 'codex',
      destination: result.destination,
      files: result.ownedPaths,
      fileHashes: result.fileHashes,
      installedAt: new Date().toISOString(),
    } satisfies InstallationRecord;

    await uninstallInstallation(record, { homeDirectory });

    await expect(readFile(result.destination, 'utf8')).resolves.toBe('# Existing guidance\n');
    await expect(
      readFile(join(homeDirectory, '.ai-directory', 'rules', 'typescript-quality.md'), 'utf8'),
    ).rejects.toThrow();
  });

  it('uses a Codex AGENTS override file when it exists', async () => {
    const homeDirectory = await createTemporaryDirectory();
    const overridePath = join(homeDirectory, '.codex', 'AGENTS.override.md');
    await mkdir(join(homeDirectory, '.codex'), { recursive: true });
    await writeFile(overridePath, '# Override guidance\n', 'utf8');

    const [result] = await installCodexResources([ruleResource], {
      homeDirectory,
    });

    expect(result.destination).toBe(overridePath);
    await expect(readFile(overridePath, 'utf8')).resolves.toContain(
      '# TypeScript quality',
    );
    await expect(readFile(join(homeDirectory, '.codex', 'AGENTS.md'), 'utf8')).rejects.toThrow();
  });

  it('honors official harness path environment overrides', async () => {
    const directory = await createTemporaryDirectory();
    const claudeConfigDirectory = join(directory, 'claude-config');
    const codexHome = join(directory, 'codex-home');
    const openCodeConfigDirectory = join(directory, 'opencode-config');

    const [claudeResult] = await installClaudeCodeResources([resource], {
      homeDirectory: directory,
      environment: { CLAUDE_CONFIG_DIR: claudeConfigDirectory },
    });
    const [codexResult] = await installCodexResources([agentResource], {
      homeDirectory: directory,
      environment: { CODEX_HOME: codexHome },
    });
    const [openCodeResult] = await installOpenCodeResources([resource], {
      homeDirectory: directory,
      environment: { OPENCODE_CONFIG_DIR: openCodeConfigDirectory },
    });

    expect(claudeResult.destination).toBe(
      join(claudeConfigDirectory, 'skills', 'typescript-api-review'),
    );
    expect(codexResult.destination).toBe(
      join(codexHome, 'agents', 'api-reviewer.toml'),
    );
    expect(openCodeResult.destination).toBe(
      join(openCodeConfigDirectory, 'skills', 'typescript-api-review'),
    );
  });

  it('honors a custom OpenCode config file path', async () => {
    const directory = await createTemporaryDirectory();
    const configPath = join(directory, 'custom', 'opencode.jsonc');

    await installOpenCodeResources([ruleResource], {
      homeDirectory: directory,
      environment: { OPENCODE_CONFIG: configPath },
    });

    await expect(readFile(configPath, 'utf8')).resolves.toContain(
      'rules/typescript-quality.md',
    );
  });

  it('installs a plugin as a Claude Code skills-directory plugin', async () => {
    const homeDirectory = await createTemporaryDirectory();

    const [result] = await installClaudeCodeResources([pluginResource], {
      homeDirectory,
    });

    expect(result.destination).toBe(join(homeDirectory, '.claude', 'skills', 'review-pack'));
    await expect(
      readFile(join(result.destination, '.claude-plugin', 'plugin.json'), 'utf8'),
    ).resolves.toContain('"name":"review-pack"');
    await expect(
      readFile(join(result.destination, 'skills', 'reviewer', 'SKILL.md'), 'utf8'),
    ).resolves.toBe('# Reviewer\n');
  });

  it('installs a tool bundle and preserves its Claude adapter files', async () => {
    const homeDirectory = await createTemporaryDirectory();

    const [result] = await installClaudeCodeResources([toolResource], { homeDirectory });

    expect(result.destination).toBe(join(homeDirectory, '.claude', 'skills', 'rtk'));
    await expect(readFile(join(result.destination, 'TOOL.md'), 'utf8')).resolves.toContain(
      'command: rtk',
    );
    await expect(readFile(join(result.destination, 'bin', 'rtk'), 'utf8')).resolves.toContain(
      'printf "rtk',
    );
    await expect(
      access(join(result.destination, 'bin', 'rtk'), constants.X_OK),
    ).resolves.toBeUndefined();
  });

  it('installs OpenCode tool adapters and support files', async () => {
    const homeDirectory = await createTemporaryDirectory();

    const [result] = await installOpenCodeResources([toolResource], { homeDirectory });

    expect(result.destination).toBe(
      join(homeDirectory, '.config', 'opencode', 'plugins', 'rtk.ts'),
    );
    await expect(
      readFile(join(homeDirectory, '.config', 'opencode', 'tools', 'rtk', 'rtk.ts'), 'utf8'),
    ).resolves.toBe('export const tool = {}\n');
    await expect(
      readFile(
        join(homeDirectory, '.config', 'opencode', 'plugins', 'rtk.files', 'bin', 'rtk'),
        'utf8',
      ),
    ).resolves.toContain('printf "rtk');
  });

  it('rejects an OpenCode tool without an adapter', async () => {
    const homeDirectory = await createTemporaryDirectory();

    await expect(
      installOpenCodeResources([{
        ...toolResource,
        files: toolResource.files.filter((file) => !file.path.startsWith('.opencode/')),
      }], { homeDirectory }),
    ).rejects.toThrow('missing an OpenCode adapter');
  });

  it('installs the OpenCode plugin module into the plugins directory', async () => {
    const homeDirectory = await createTemporaryDirectory();

    const [result] = await installOpenCodeResources([pluginResource], {
      homeDirectory,
    });

    expect(result.destination).toBe(
      join(homeDirectory, '.config', 'opencode', 'plugins', 'review-pack.ts'),
    );
    await expect(readFile(result.destination, 'utf8')).resolves.toBe(
      'export const ReviewPack = async () => ({})\n',
    );
  });

  it('refuses to install a plugin for OpenCode without a module', async () => {
    const homeDirectory = await createTemporaryDirectory();

    await expect(
      installOpenCodeResources(
        [{
          ...pluginResource,
          files: pluginResource.files.filter(
            (file) => !file.path.startsWith('.opencode/'),
          ),
        }],
        { homeDirectory },
      ),
    ).rejects.toThrow('missing an OpenCode module');
  });

  it('installs a Codex plugin bundle and registers a personal marketplace', async () => {
    const homeDirectory = await createTemporaryDirectory();

    const [result] = await installCodexResources([pluginResource], {
      homeDirectory,
    });

    expect(result.destination).toBe(join(homeDirectory, '.codex', 'plugins', 'review-pack'));
    await expect(
      readFile(join(result.destination, '.claude-plugin', 'plugin.json'), 'utf8'),
    ).resolves.toContain('"name":"review-pack"');
    const marketplace = await readFile(
      join(homeDirectory, '.agents', 'plugins', 'marketplace.json'),
      'utf8',
    );
    expect(marketplace).toContain('"name": "review-pack"');
    expect(marketplace).toContain('../.codex/plugins/review-pack');
  });

  it('uninstalls a Codex plugin and removes its marketplace entry', async () => {
    const homeDirectory = await createTemporaryDirectory();

    const [result] = await installCodexResources([pluginResource], {
      homeDirectory,
    });
    const record = {
      resource: resourceKey(pluginResource.resource),
      version: pluginResource.version,
      harness: 'codex',
      destination: result.destination,
      files: result.ownedPaths,
      fileHashes: result.fileHashes,
      installedAt: new Date().toISOString(),
    } satisfies InstallationRecord;

    await uninstallInstallation(record, { homeDirectory });

    await expect(
      readFile(
        join(homeDirectory, '.codex', 'plugins', 'review-pack', '.claude-plugin', 'plugin.json'),
        'utf8',
      ),
    ).rejects.toThrow();
    const marketplace = await readFile(
      join(homeDirectory, '.agents', 'plugins', 'marketplace.json'),
      'utf8',
    );
    expect(marketplace).not.toContain('"name": "review-pack"');
  });
});

describe('shared resource operations', () => {
  it('plans, applies, and removes one operation across multiple harnesses', async () => {
    const homeDirectory = await createTemporaryDirectory();
    const operation = {
      resource: resourceKey(resource.resource),
      harnesses: ['claude-code', 'opencode'] as const,
      action: 'install' as const,
      resources: [resource],
      warningResources: [resource],
    };

    const plan = await planResourceOperations([operation], { homeDirectory });
    expect(plan.changes).toHaveLength(4);
    expect(plan.conflicts).toEqual([]);

    const applied = await applyResourceOperations(
      [operation],
      { homeDirectory },
      false,
      plan,
    );
    expect(applied.installed).toHaveLength(2);
    await expect(
      readFile(join(homeDirectory, '.local', 'share', 'ai-directory', 'installed.json.lock'), 'utf8'),
    ).rejects.toThrow();

    const uninstall = await applyResourceOperations(
      [{
        resource: operation.resource,
        harnesses: [...operation.harnesses],
        action: 'uninstall' as const,
        resourceIds: [operation.resource],
      }],
      { homeDirectory },
    );
    expect(uninstall.removed).toHaveLength(2);
  });

  it('blocks an operation while another process owns the install lock', async () => {
    const homeDirectory = await createTemporaryDirectory();
    const lockPath = join(homeDirectory, '.local', 'share', 'ai-directory', 'installed.json.lock');
    await mkdir(join(homeDirectory, '.local', 'share', 'ai-directory'), { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({ pid: process.pid, token: 'test-lock' }),
      'utf8',
    );

    await expect(
      applyResourceOperations(
        [{
          resource: resourceKey(resource.resource),
          harnesses: ['claude-code'],
          action: 'install',
          resources: [resource],
        }],
        { homeDirectory },
      ),
    ).rejects.toThrow('Another AI Directory installation is in progress');
  });

  it('reclaims a lock owned by a dead process', async () => {
    const homeDirectory = await createTemporaryDirectory();
    const lockPath = join(homeDirectory, '.local', 'share', 'ai-directory', 'installed.json.lock');
    await mkdir(join(homeDirectory, '.local', 'share', 'ai-directory'), { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({ pid: Number.MAX_SAFE_INTEGER, token: 'stale-lock' }),
      'utf8',
    );

    await expect(
      applyResourceOperations(
        [{
          resource: resourceKey(resource.resource),
          harnesses: ['claude-code'],
          action: 'install',
          resources: [resource],
        }],
        { homeDirectory },
      ),
    ).resolves.toMatchObject({ installed: [expect.anything()] });
    await expect(readFile(lockPath, 'utf8')).rejects.toThrow();
  });

  it('applies an operation inside the supplied home directory', async () => {
    const homeDirectory = await createTemporaryDirectory();
    const operation = {
      resource: resourceKey(resource.resource),
      harnesses: ['claude-code', 'opencode', 'codex'] as const,
      action: 'install' as const,
      resources: [resourceWithCodexMetadata],
    };

    const applied = await applyResourceOperations(
      [operation],
      {
        homeDirectory,
        environment: { CODEX_HOME: join(homeDirectory, '.codex') },
      },
    );

    expect(applied.installed).toHaveLength(3);
    await expect(
      readFile(
        join(homeDirectory, '.claude', 'skills', 'typescript-api-review', 'SKILL.md'),
        'utf8',
      ),
    ).resolves.toBe('# API review\n');
    await expect(
      readFile(
        join(homeDirectory, '.config', 'opencode', 'skills', 'typescript-api-review', 'SKILL.md'),
        'utf8',
      ),
    ).resolves.toBe('# API review\n');
    await expect(
      readFile(
        join(homeDirectory, '.agents', 'skills', 'typescript-api-review', 'agents', 'openai.yaml'),
        'utf8',
      ),
    ).resolves.toContain('display_name');
    await expect(
      readFile(join(homeDirectory, '.local', 'share', 'ai-directory', 'installed.json'), 'utf8'),
    ).resolves.toContain('jose-rosendo/skills/typescript-api-review');
  });

  it('rejects a stale plan before writing files', async () => {
    const homeDirectory = await createTemporaryDirectory();
    const configPath = join(homeDirectory, '.config', 'opencode', 'opencode.json');
    const operation = {
      resource: resourceKey(ruleResource.resource),
      harnesses: ['claude-code', 'opencode'] as const,
      action: 'install' as const,
      resources: [ruleResource],
      warningResources: [ruleResource],
    };

    await mkdir(join(homeDirectory, '.config', 'opencode'), { recursive: true });
    await writeFile(configPath, '{"instructions": []}\n', 'utf8');
    const plan = await planResourceOperations([operation], { homeDirectory });
    await writeFile(configPath, '{ invalid json\n', 'utf8');

    const failure = applyResourceOperations([operation], { homeDirectory }, false, plan);
    await expect(failure).rejects.toThrow('Change plan is outdated. Generate a new preview before applying.');
    await expect(
      readFile(join(homeDirectory, '.claude', 'rules', 'typescript-quality.md'), 'utf8'),
    ).rejects.toThrow();
    await expect(
      readFile(join(homeDirectory, '.local', 'share', 'ai-directory', 'installed.json'), 'utf8'),
    ).rejects.toThrow();
    await expect(readFile(configPath, 'utf8')).resolves.toBe('{ invalid json\n');
    await expect(
      readFile(join(homeDirectory, '.local', 'share', 'ai-directory', 'installed.json.lock'), 'utf8'),
    ).rejects.toThrow();
  });

  it('rolls back earlier harness changes when a later write fails', async () => {
    const homeDirectory = await createTemporaryDirectory();
    const operation = {
      resource: resourceKey(resource.resource),
      harnesses: ['claude-code', 'opencode'] as const,
      action: 'install' as const,
      resources: [resource],
    };

    const plan = await planResourceOperations([operation], { homeDirectory });
    const failedInstaller = vi
      .spyOn(openCodeInstaller, 'install')
      .mockRejectedValueOnce(new Error('simulated OpenCode failure'));

    try {
      const failure = applyResourceOperations([operation], { homeDirectory }, false, plan);
      await expect(failure).rejects.toThrow('Failed to install jose-rosendo/skills/typescript-api-review');
      await expect(failure).rejects.toThrow('All changes were rolled back');
      await expect(
        readFile(join(homeDirectory, '.claude', 'skills', 'typescript-api-review', 'SKILL.md'), 'utf8'),
      ).rejects.toThrow();
      await expect(
        readFile(join(homeDirectory, '.local', 'share', 'ai-directory', 'installed.json'), 'utf8'),
      ).rejects.toThrow();
    } finally {
      failedInstaller.mockRestore();
    }
  });
});

describe('installation manifest', () => {
  it('reads missing manifests and replaces records by resource', async () => {
    const directory = await createTemporaryDirectory();
    const path = join(directory, 'installed.json');
    const record = {
      resource: 'jose-rosendo/skills/typescript-api-review',
      version: '1.0.0',
      harness: 'claude-code',
      destination: join(directory, '.claude', 'skills', 'typescript-api-review'),
      files: [join(directory, '.claude', 'skills', 'typescript-api-review', 'SKILL.md')],
      installedAt: '2026-08-11T10:00:00.000Z',
    } satisfies InstallationRecord;

    await expect(readInstallationManifest(path)).resolves.toEqual({
      schemaVersion: 1,
      installations: [],
    });
    await updateInstallationManifest(path, [record]);
    await updateInstallationManifest(path, [{ ...record, version: '1.1.0' }]);

    await expect(readInstallationManifest(path)).resolves.toMatchObject({
      installations: [expect.objectContaining({ version: '1.1.0' })],
    });
  });

  it('removes files left by an older installation', async () => {
    const directory = await createTemporaryDirectory();
    const oldFile = join(directory, 'old.md');
    await writeFile(oldFile, 'old\n', 'utf8');

    const record = {
      resource: 'jose-rosendo/skills/typescript-api-review',
      version: '1.0.0',
      harness: 'claude-code',
      destination: directory,
      files: [oldFile],
      fileHashes: {
        [oldFile]: createHash('sha256').update('old\n').digest('hex'),
      },
      installedAt: '2026-08-11T10:00:00.000Z',
    } satisfies InstallationRecord;

    await removeStaleInstallationFiles([record], []);
    await expect(readFile(oldFile, 'utf8')).rejects.toThrow();
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ai-directory-install-'));
  temporaryDirectories.push(directory);
  return directory;
}
