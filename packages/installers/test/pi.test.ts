import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ResourceVersion } from '@ai-directory/registry';
import { installPiResources } from '../src/index.js';
import {
  cleanupTemporaryDirectories,
  createTemporaryDirectory,
  resource,
  ruleResource,
} from './fixtures.js';

afterEach(cleanupTemporaryDirectories);

function piOptions(directory: string) {
  return {
    cwd: directory,
    homeDirectory: directory,
    environment: { PI_CODING_AGENT_DIR: join(directory, '.pi', 'agent') },
  };
}

describe('Pi installation', () => {
  it('installs a skill into the Pi skills directory', async () => {
    const directory = await createTemporaryDirectory();
    const options = piOptions(directory);

    const [result] = await installPiResources([resource], options);

    expect(result.destination).toBe(
      join(directory, '.pi', 'agent', 'skills', 'typescript-api-review'),
    );
    await expect(
      readFile(join(directory, '.pi', 'agent', 'skills', 'typescript-api-review', 'SKILL.md'), 'utf8'),
    ).resolves.toBe('# API review\n');
  });

  it('installs rules into a managed AGENTS.md block', async () => {
    const directory = await createTemporaryDirectory();
    const options = piOptions(directory);

    const [result] = await installPiResources([ruleResource], options);

    const guidancePath = join(directory, '.pi', 'agent', 'AGENTS.md');
    expect(result.destination).toBe(guidancePath);
    const content = await readFile(guidancePath, 'utf8');
    expect(content).toContain('<!-- ai-directory:rule:jose-rosendo/rules/typescript-quality -->');
    expect(content).toContain('# TypeScript quality');
    expect(content).toContain('<!-- /ai-directory:rule:jose-rosendo/rules/typescript-quality -->');
  });

  it('installs a plugin extension into the Pi extensions directory', async () => {
    const directory = await createTemporaryDirectory();
    const options = piOptions(directory);
    const pluginResource = {
      ...resource,
      resource: {
        ...resource.resource,
        type: 'plugins',
        name: 'review-pack',
      },
      files: [
        { path: '.pi/extension.ts', content: 'export const pack = async () => ({})\n' },
        { path: 'skills/reviewer/SKILL.md', content: '# Reviewer\n' },
      ],
    } satisfies ResourceVersion;

    const [result] = await installPiResources([pluginResource], options);

    expect(result.destination).toBe(
      join(directory, '.pi', 'agent', 'extensions', 'review-pack.ts'),
    );
    await expect(
      readFile(join(directory, '.pi', 'agent', 'extensions', 'review-pack.ts'), 'utf8'),
    ).resolves.toBe('export const pack = async () => ({})\n');
    await expect(
      readFile(
        join(directory, '.pi', 'agent', 'extensions', 'review-pack.files', 'skills', 'reviewer', 'SKILL.md'),
        'utf8',
      ),
    ).resolves.toBe('# Reviewer\n');
  });

  it('rejects agents because Pi has no sub-agents', async () => {
    const directory = await createTemporaryDirectory();
    const agentResource = {
      ...resource,
      resource: { ...resource.resource, type: 'agents', name: 'reviewer' },
      files: [{ path: 'AGENT.md', content: '# Reviewer\n' }],
    } satisfies ResourceVersion;

    await expect(installPiResources([agentResource], piOptions(directory))).rejects.toThrow(
      'Pi does not support agents',
    );
  });

  it('rejects MCP servers because Pi has no MCP support', async () => {
    const directory = await createTemporaryDirectory();
    const mcpResource = {
      ...resource,
      resource: { ...resource.resource, type: 'mcp-servers', name: 'github' },
      files: [{ path: 'MCP.md', content: '---\nname: github\ndescription: GitHub.\ntransport: http\nurl: https://example.com\n---\n' }],
    } satisfies ResourceVersion;

    await expect(installPiResources([mcpResource], piOptions(directory))).rejects.toThrow(
      'Pi does not support MCP servers',
    );
  });

  it('requires force to overwrite an existing managed AGENTS.md rule block', async () => {
    const directory = await createTemporaryDirectory();
    const options = piOptions(directory);
    const guidancePath = join(directory, '.pi', 'agent', 'AGENTS.md');
    await mkdir(join(directory, '.pi', 'agent'), { recursive: true });
    await writeFile(
      guidancePath,
      [
        '# Existing guidance',
        '',
        '<!-- ai-directory:rule:jose-rosendo/rules/typescript-quality -->',
        '# TypeScript quality',
        '<!-- /ai-directory:rule:jose-rosendo/rules/typescript-quality -->',
        '',
      ].join('\n'),
      'utf8',
    );

    await expect(installPiResources([ruleResource], options)).rejects.toThrow(
      'Pi rule is already installed',
    );

    const [result] = await installPiResources([ruleResource], { ...options, force: true });
    expect(result.destination).toBe(guidancePath);
    const content = await readFile(guidancePath, 'utf8');
    expect(content).toContain('# TypeScript quality');
  });
});
