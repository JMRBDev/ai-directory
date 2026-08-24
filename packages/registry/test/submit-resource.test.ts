import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { submitResource } from '../src/index.js';
import { cleanupTemporaryDirectories, createPublishFixture } from './helpers.js';

afterEach(cleanupTemporaryDirectories);

describe('submitResource', () => {
  it('creates a branch, pushes it, and opens a pull request', async () => {
    const { indexPath, sourceDirectory } = await createPublishFixture();
    await writeFile(join(sourceDirectory, 'SKILL.md'), '# Release check\n', 'utf8');
    const commands: string[] = [];

    const result = await submitResource({
      indexPath,
      sourceDirectory,
      resourceId: 'jane-doe/skills/release-check',
      version: '1.0.0',
      description: 'Check releases.',
      branch: 'submit/release-check-1.0.0',
      title: 'Submit release check',
      body: 'Please review.',
      commandRunner: async (command, args) => {
        commands.push(`${command} ${args.join(' ')}`);

        if (command === 'git' && args[0] === 'branch') {
          return { stdout: 'main\n', stderr: '' };
        }

        if (command === 'git' && args[0] === 'rev-parse') {
          return { stdout: 'abc123\n', stderr: '' };
        }

        if (command === 'gh' && args[0] === 'pr') {
          return { stdout: 'https://github.com/example/registry/pull/42\n', stderr: '' };
        }

        return { stdout: '', stderr: '' };
      },
    });

    expect(result).toMatchObject({
      branch: 'submit/release-check-1.0.0',
      commit: 'abc123',
      pullRequestUrl: 'https://github.com/example/registry/pull/42',
    });
    expect(commands).toEqual([
      'git status --porcelain --untracked-files=all',
      'git branch --show-current',
      'git remote get-url origin',
      'gh auth status',
      'git switch -c submit/release-check-1.0.0',
      'git add --sparse -- index.json resources/jane-doe/skills/release-check/1.0.0',
      'git commit -m Submit jane-doe/skills/release-check@1.0.0',
      'git rev-parse HEAD',
      'git push --set-upstream origin submit/release-check-1.0.0',
      'gh pr create --base main --head submit/release-check-1.0.0 --title Submit release check --body Please review.',
    ]);
  });

  it('refuses to submit from a dirty registry checkout', async () => {
    const { indexPath, sourceDirectory } = await createPublishFixture();

    await expect(
      submitResource({
        indexPath,
        sourceDirectory,
        resourceId: 'jane-doe/skills/release-check',
        version: '1.0.0',
        description: 'Check releases.',
        commandRunner: async () => ({ stdout: ' M index.json\n', stderr: '' }),
      }),
    ).rejects.toThrow('Registry working tree is not clean');
  });

  it('uses a temporary partial clone for remote repositories', async () => {
    const { indexPath, sourceDirectory } = await createPublishFixture();
    await writeFile(join(sourceDirectory, 'SKILL.md'), '# Remote release check\n', 'utf8');
    const commands: string[] = [];
    let temporaryRepository = '';

    const result = await submitResource({
      indexPath,
      sourceDirectory,
      repositoryUrl: 'git@example.com:company/registry.git',
      resourceId: 'jane-doe/skills/remote-check',
      version: '1.0.0',
      description: 'Check remote releases.',
      branch: 'submit/remote-check-1.0.0',
      commandRunner: async (command, args) => {
        commands.push(`${command} ${args.join(' ')}`);

        if (command === 'git' && args[0] === 'clone') {
          const destination = args.at(-1);

          if (!destination) {
            throw new Error('Missing clone destination.');
          }

          temporaryRepository = destination;
          await writeFile(
            join(destination, 'index.json'),
            JSON.stringify({ schemaVersion: 1, resources: [] }),
            'utf8',
          );
        }

        if (command === 'git' && args[0] === 'branch') {
          return { stdout: 'main\n', stderr: '' };
        }

        if (command === 'git' && args[0] === 'rev-parse') {
          return { stdout: 'def456\n', stderr: '' };
        }

        if (command === 'gh' && args[0] === 'pr') {
          return { stdout: 'https://github.com/example/registry/pull/43\n', stderr: '' };
        }

        return { stdout: '', stderr: '' };
      },
    });

    expect(result.pullRequestUrl).toBe('https://github.com/example/registry/pull/43');
    expect(commands.slice(0, 4)).toEqual([
      'git clone --filter=blob:none --no-checkout --branch main git@example.com:company/registry.git ' +
        temporaryRepository,
      'git sparse-checkout init --no-cone',
      'git sparse-checkout set index.json',
      'git checkout main',
    ]);
    await expect(readFile(join(temporaryRepository, 'index.json'), 'utf8')).rejects.toThrow();
  });
});
