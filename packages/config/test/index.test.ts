import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getRepositorySetting,
  readConfigFile,
  writeConfigFile,
} from '../src/index.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('AI Directory config', () => {
  it('writes and reads a repository config atomically', async () => {
    const directory = await createTemporaryDirectory();
    const path = join(directory, 'config.json');

    await writeConfigFile(path, {
      repository: 'git@github.com:company/registry.git',
    });

    expect(readConfigFile(path)).toEqual({
      repository: 'git@github.com:company/registry.git',
    });
    await expect(readFile(path, 'utf8')).resolves.toContain('repository');
  });

  it('resolves explicit, environment, and project values in order', async () => {
    const directory = await createTemporaryDirectory();
    const projectConfigPath = join(directory, '.ai-directory', 'config.json');
    const previousRepository = process.env.AI_DIRECTORY_REGISTRY_REPOSITORY;

    await mkdir(join(directory, '.ai-directory'), { recursive: true });
    await writeFile(
      projectConfigPath,
      JSON.stringify({ repository: 'git@github.com:company/project-registry.git' }),
      'utf8',
    );

    try {
      process.env.AI_DIRECTORY_REGISTRY_REPOSITORY = 'git@github.com:company/env-registry.git';
      expect(getRepositorySetting(undefined, directory)).toEqual({
        value: 'git@github.com:company/env-registry.git',
        source: 'environment',
      });
      expect(
        getRepositorySetting('git@github.com:company/argument-registry.git', directory),
      ).toEqual({
        value: 'git@github.com:company/argument-registry.git',
        source: 'argument',
      });

      delete process.env.AI_DIRECTORY_REGISTRY_REPOSITORY;
      expect(getRepositorySetting(undefined, directory)).toEqual({
        value: 'git@github.com:company/project-registry.git',
        source: 'project',
      });
    } finally {
      if (previousRepository === undefined) {
        delete process.env.AI_DIRECTORY_REGISTRY_REPOSITORY;
      } else {
        process.env.AI_DIRECTORY_REGISTRY_REPOSITORY = previousRepository;
      }
    }
  });

  it('rejects malformed config values', async () => {
    const directory = await createTemporaryDirectory();
    const path = join(directory, 'config.json');

    await writeFile(path, JSON.stringify({ repository: 42 }), 'utf8');

    expect(() => readConfigFile(path)).toThrow('repository must be a non-empty string');
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ai-directory-config-'));
  temporaryDirectories.push(directory);
  return directory;
}
