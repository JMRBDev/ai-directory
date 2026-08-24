import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installClaudeCodeResources } from '../src/index.js';
import {
  agentResource,
  cleanupTemporaryDirectories,
  createTemporaryDirectory,
  pluginResource,
  resource,
  ruleResource,
  toolResource,
} from './fixtures.js';

afterEach(cleanupTemporaryDirectories);


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

  it('rejects plugin and tool bundles that share a destination', async () => {
    const homeDirectory = await createTemporaryDirectory();
    const collidingTool = {
      ...toolResource,
      resource: {
        ...toolResource.resource,
        name: pluginResource.resource.name,
      },
      files: [
        {
          ...toolResource.files[0],
          content: toolResource.files[0].content
            .replace('name: rtk', 'name: review-pack')
            .replace('executables:\n  - bin/rtk\n', ''),
        },
      ],
    } satisfies ResourceVersion;

    await installClaudeCodeResources([pluginResource], { homeDirectory });

    await expect(
      installClaudeCodeResources([collidingTool], { homeDirectory }),
    ).rejects.toThrow('Install destinations are not available');
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
