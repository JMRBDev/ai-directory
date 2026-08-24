import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resourceKey } from '@ai-directory/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getHarnessAdapter,
  installClaudeCodeResources,
  installCodexResources,
  installOpenCodeResources,
  uninstallInstallation,
} from '../src/index.js';
import {
  agentResource,
  cleanupTemporaryDirectories,
  createTemporaryDirectory,
  resource,
  resourceWithCodexMetadata,
  ruleResource,
} from './fixtures.js';

afterEach(cleanupTemporaryDirectories);

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
      shared: result.shared,
      installedAt: new Date().toISOString(),
    } satisfies InstallationRecord;

    await uninstallInstallation(record, { homeDirectory });

    await expect(readFile(result.destination, 'utf8')).rejects.toThrow();
    await expect(readFile(configPath, 'utf8')).resolves.not.toContain(
      'rules/typescript-quality.md',
    );
    await expect(readFile(configPath, 'utf8')).resolves.toContain('README.md');
  });

  it('preserves an OpenCode instruction that existed before installation', async () => {
    const homeDirectory = await createTemporaryDirectory();
    const configPath = join(homeDirectory, '.config', 'opencode', 'opencode.json');
    const entry = 'rules/typescript-quality.md';
    await mkdir(join(homeDirectory, '.config', 'opencode'), { recursive: true });
    await writeFile(configPath, JSON.stringify({ instructions: [entry] }) + '\n', 'utf8');

    const [result] = await installOpenCodeResources([ruleResource], { homeDirectory });
    const record = {
      resource: resourceKey(ruleResource.resource),
      version: ruleResource.version,
      harness: 'opencode',
      destination: result.destination,
      files: result.ownedPaths,
      fileHashes: result.fileHashes,
      shared: result.shared,
      installedAt: new Date().toISOString(),
    } satisfies InstallationRecord;

    expect(result.shared).toEqual([]);
    await uninstallInstallation(record, { homeDirectory });

    await expect(readFile(configPath, 'utf8')).resolves.toContain(entry);
  });

  it('removes a platform-created OpenCode config after the final rule uninstall', async () => {
    const homeDirectory = await createTemporaryDirectory();
    const [result] = await installOpenCodeResources([ruleResource], { homeDirectory });
    const record = {
      resource: resourceKey(ruleResource.resource),
      version: ruleResource.version,
      harness: 'opencode',
      destination: result.destination,
      files: result.ownedPaths,
      fileHashes: result.fileHashes,
      shared: result.shared,
      installedAt: new Date().toISOString(),
    } satisfies InstallationRecord;

    await uninstallInstallation(record, { homeDirectory });

    await expect(
      readFile(join(homeDirectory, '.config', 'opencode', 'opencode.json'), 'utf8'),
    ).rejects.toThrow();
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
      shared: result.shared,
      installedAt: new Date().toISOString(),
    } satisfies InstallationRecord;

    await uninstallInstallation(record, { homeDirectory });

    await expect(readFile(result.destination, 'utf8')).resolves.toBe('# Existing guidance\n');
    await expect(
      readFile(join(homeDirectory, '.ai-directory', 'rules', 'typescript-quality.md'), 'utf8'),
    ).rejects.toThrow();
  });

  it('protects a Codex rule block that was modified after installation', async () => {
    const homeDirectory = await createTemporaryDirectory();
    const [result] = await installCodexResources([ruleResource], { homeDirectory });
    const record = {
      resource: resourceKey(ruleResource.resource),
      version: ruleResource.version,
      harness: 'codex',
      destination: result.destination,
      files: result.ownedPaths,
      fileHashes: result.fileHashes,
      shared: result.shared,
      installedAt: new Date().toISOString(),
    } satisfies InstallationRecord;
    await writeFile(
      result.destination,
      (await readFile(result.destination, 'utf8')).replace(
        '# TypeScript quality',
        '# Locally changed TypeScript quality',
      ),
      'utf8',
    );

    await expect(uninstallInstallation(record, { homeDirectory })).rejects.toThrow(
      'managed rule block was modified',
    );
    await expect(readFile(result.destination, 'utf8')).resolves.toContain(
      '# Locally changed TypeScript quality',
    );

    await uninstallInstallation(record, { homeDirectory, force: true });
    await expect(readFile(result.destination, 'utf8')).rejects.toThrow();
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
});
