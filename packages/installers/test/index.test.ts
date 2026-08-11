import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ResourceVersion } from '@ai-directory/registry';
import {
  installClaudeCodeResource,
  installClaudeCodeResources,
  installCodexResources,
  installOpenCodeResources,
  getHarnessAdapter,
  readInstallationManifest,
  removeStaleInstallationFiles,
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

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('installClaudeCodeResource', () => {
  it('installs a skill in a project-local Claude Code directory', async () => {
    const projectDirectory = await createTemporaryDirectory();

    const result = await installClaudeCodeResource(resource, {
      scope: 'project',
      cwd: projectDirectory,
    });

    expect(result.destination).toBe(
      join(projectDirectory, '.claude', 'skills', 'typescript-api-review'),
    );
    await expect(readFile(join(result.destination, 'SKILL.md'), 'utf8')).resolves.toBe(
      '# API review\n',
    );
    await expect(
      readFile(join(result.destination, 'references', 'checklist.md'), 'utf8'),
    ).resolves.toBe('- Check errors\n');
  });

  it('installs in the supplied global home and refuses accidental overwrites', async () => {
    const homeDirectory = await createTemporaryDirectory();

    await installClaudeCodeResource(resource, {
      scope: 'global',
      homeDirectory,
    });

    await expect(
      installClaudeCodeResource(resource, {
        scope: 'global',
        homeDirectory,
      }),
    ).rejects.toThrow('Use --force to overwrite.');

    await expect(
      installClaudeCodeResource(resource, {
        scope: 'global',
        homeDirectory,
        force: true,
      }),
    ).resolves.toMatchObject({
      destination: join(homeDirectory, '.claude', 'skills', 'typescript-api-review'),
    });
  });

  it('installs agents and rules as Claude Code flat files', async () => {
    const projectDirectory = await createTemporaryDirectory();

    const [agentResult, ruleResult] = await installClaudeCodeResources(
      [agentResource, ruleResource],
      {
        scope: 'project',
        cwd: projectDirectory,
      },
    );

    expect(agentResult.destination).toBe(
      join(projectDirectory, '.claude', 'agents', 'api-reviewer.md'),
    );
    expect(ruleResult.destination).toBe(
      join(projectDirectory, '.claude', 'rules', 'typescript-quality.md'),
    );
    await expect(readFile(agentResult.destination, 'utf8')).resolves.toBe('# API reviewer\n');
    await expect(readFile(ruleResult.destination, 'utf8')).resolves.toBe(
      '# TypeScript quality\n',
    );
    await expect(
      readFile(
        join(
          projectDirectory,
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
          projectDirectory,
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
    const projectDirectory = await createTemporaryDirectory();

    await installClaudeCodeResource(resource, {
      scope: 'project',
      cwd: projectDirectory,
    });

    await expect(
      installClaudeCodeResources([resource, agentResource], {
        scope: 'project',
        cwd: projectDirectory,
      }),
    ).rejects.toThrow('Use --force to overwrite.');

    await expect(
      readFile(join(projectDirectory, '.claude', 'agents', 'api-reviewer.md'), 'utf8'),
    ).rejects.toThrow();
  });

  it('rejects overlapping batch destinations even with force', async () => {
    const projectDirectory = await createTemporaryDirectory();

    await expect(
      installClaudeCodeResources([resource, resource], {
        scope: 'project',
        cwd: projectDirectory,
        force: true,
      }),
    ).rejects.toThrow('Install resources overlap');
  });

  it('does not install templates as standalone Claude Code resources', async () => {
    const projectDirectory = await createTemporaryDirectory();
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
      installClaudeCodeResource(templateResource, {
        scope: 'project',
        cwd: projectDirectory,
      }),
    ).rejects.toThrow('Templates must be expanded first.');
  });

  it('rejects files that escape the resource directory', async () => {
    const projectDirectory = await createTemporaryDirectory();
    const unsafeResource = {
      ...resource,
      files: [{ path: '../outside.md', content: 'unsafe\n' }],
    } satisfies ResourceVersion;

    await expect(
      installClaudeCodeResource(unsafeResource, {
        scope: 'project',
        cwd: projectDirectory,
      }),
    ).rejects.toThrow('Unsafe resource file path');
  });
});

describe('portable harness installers', () => {
  it('exposes the harness capability matrix', () => {
    expect(getHarnessAdapter('claude-code').capabilities).toEqual({
      skills: 'native',
      agents: 'native',
      rules: 'native',
    });
    expect(getHarnessAdapter('opencode').capabilities).toEqual({
      skills: 'native',
      agents: 'translated',
      rules: 'configured',
    });
    expect(getHarnessAdapter('codex').capabilities).toEqual({
      skills: 'native',
      agents: 'translated',
      rules: 'configured',
    });
  });

  it('installs native OpenCode skills and agents', async () => {
    const projectDirectory = await createTemporaryDirectory();

    const [skillResult, agentResult] = await installOpenCodeResources(
      [resource, agentResource],
      { scope: 'project', cwd: projectDirectory },
    );

    expect(skillResult.destination).toBe(
      join(projectDirectory, '.opencode', 'skills', 'typescript-api-review'),
    );
    expect(agentResult.destination).toBe(
      join(projectDirectory, '.opencode', 'agents', 'api-reviewer.md'),
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

  it('installs native Codex skills and converts agents to TOML', async () => {
    const projectDirectory = await createTemporaryDirectory();

    const [skillResult, agentResult] = await installCodexResources(
      [resource, agentResource],
      { scope: 'project', cwd: projectDirectory },
    );

    expect(skillResult.destination).toBe(
      join(projectDirectory, '.agents', 'skills', 'typescript-api-review'),
    );
    expect(agentResult.destination).toBe(
      join(projectDirectory, '.codex', 'agents', 'api-reviewer.toml'),
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
      scope: 'global',
      homeDirectory,
    });
    const [codexResult] = await installCodexResources([agentResource], {
      scope: 'global',
      homeDirectory,
    });

    expect(openCodeResult.destination).toBe(
      join(homeDirectory, '.config', 'opencode', 'skills', 'typescript-api-review'),
    );
    expect(codexResult.destination).toBe(
      join(homeDirectory, '.codex', 'agents', 'api-reviewer.toml'),
    );

    const [ruleResult] = await installOpenCodeResources([ruleResource], {
      scope: 'global',
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
    const projectDirectory = await createTemporaryDirectory();
    const configPath = join(projectDirectory, 'opencode.jsonc');
    await writeFile(
      configPath,
      '{\n  // Keep this setting.\n  "instructions": ["README.md"]\n}\n',
      'utf8',
    );

    const [result] = await installOpenCodeResources([ruleResource], {
      scope: 'project',
      cwd: projectDirectory,
    });

    expect(result.destination).toBe(
      join(projectDirectory, '.opencode', 'rules', 'typescript-quality.md'),
    );
    await expect(readFile(result.destination, 'utf8')).resolves.toBe(
      '# TypeScript quality\n',
    );
    await expect(
      readFile(
        join(
          projectDirectory,
          '.opencode',
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
    expect(config).toContain('.opencode/rules/typescript-quality.md');

    const updatedRule = {
      ...ruleResource,
      version: '1.1.0',
      files: [{ path: 'RULE.md', content: '# Updated TypeScript quality\n' }],
    } satisfies ResourceVersion;

    await installOpenCodeResources([updatedRule], {
      scope: 'project',
      cwd: projectDirectory,
      force: true,
    });

    await expect(readFile(result.destination, 'utf8')).resolves.toBe(
      '# Updated TypeScript quality\n',
    );
    const updatedConfig = await readFile(configPath, 'utf8');
    expect(updatedConfig.split('.opencode/rules/typescript-quality.md')).toHaveLength(2);
  });

  it('installs Codex rules in managed AGENTS blocks', async () => {
    const projectDirectory = await createTemporaryDirectory();
    const agentsPath = join(projectDirectory, 'AGENTS.md');
    await writeFile(agentsPath, '# Existing guidance\n\nKeep this content.\n', 'utf8');

    const [result] = await installCodexResources([ruleResource], {
      scope: 'project',
      cwd: projectDirectory,
    });

    expect(result.destination).toBe(agentsPath);
    await expect(
      readFile(
        join(projectDirectory, '.ai-directory', 'rules', 'typescript-quality.md'),
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
      scope: 'project',
      cwd: projectDirectory,
      force: true,
    });

    const updatedAgents = await readFile(agentsPath, 'utf8');
    expect(updatedAgents).toContain('# Updated TypeScript quality');
    expect(updatedAgents).not.toContain('# TypeScript quality\n');
    expect(
      updatedAgents.split('<!-- ai-directory:rule:jose-rosendo/rules/typescript-quality -->'),
    ).toHaveLength(2);
  });

  it('uses a Codex AGENTS override file when it exists', async () => {
    const projectDirectory = await createTemporaryDirectory();
    const overridePath = join(projectDirectory, 'AGENTS.override.md');
    await writeFile(overridePath, '# Override guidance\n', 'utf8');

    const [result] = await installCodexResources([ruleResource], {
      scope: 'project',
      cwd: projectDirectory,
    });

    expect(result.destination).toBe(overridePath);
    await expect(readFile(overridePath, 'utf8')).resolves.toContain(
      '# TypeScript quality',
    );
    await expect(readFile(join(projectDirectory, 'AGENTS.md'), 'utf8')).rejects.toThrow();
  });

  it('honors official harness path environment overrides', async () => {
    const directory = await createTemporaryDirectory();
    const claudeConfigDirectory = join(directory, 'claude-config');
    const codexHome = join(directory, 'codex-home');
    const openCodeConfigDirectory = join(directory, 'opencode-config');

    const [claudeResult] = await installClaudeCodeResources([resource], {
      scope: 'global',
      environment: { CLAUDE_CONFIG_DIR: claudeConfigDirectory },
    });
    const [codexResult] = await installCodexResources([agentResource], {
      scope: 'global',
      homeDirectory: directory,
      environment: { CODEX_HOME: codexHome },
    });
    const [openCodeResult] = await installOpenCodeResources([resource], {
      scope: 'global',
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
      scope: 'global',
      homeDirectory: directory,
      environment: { OPENCODE_CONFIG: configPath },
    });

    await expect(readFile(configPath, 'utf8')).resolves.toContain(
      'rules/typescript-quality.md',
    );
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
      scope: 'project',
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
      scope: 'project',
      destination: directory,
      files: [oldFile],
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
