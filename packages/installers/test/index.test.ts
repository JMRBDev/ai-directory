import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ResourceVersion } from '@ai-directory/registry';
import { installClaudeCodeResource } from '../src/index.js';

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

    const agentResult = await installClaudeCodeResource(agentResource, {
      scope: 'project',
      cwd: projectDirectory,
    });
    const ruleResult = await installClaudeCodeResource(ruleResource, {
      scope: 'project',
      cwd: projectDirectory,
    });

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

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ai-directory-install-'));
  temporaryDirectories.push(directory);
  return directory;
}
