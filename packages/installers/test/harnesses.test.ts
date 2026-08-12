import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  detectHarnesses,
  getHarnessDefinition,
  resolveHarnessPaths,
} from '../src/index.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('harness catalog', () => {
  it('resolves official project and global paths', async () => {
    const directory = await createTemporaryDirectory();

    expect(resolveHarnessPaths('claude-code', {
      cwd: directory,
      homeDirectory: directory,
    })).toMatchObject({
      project: { skills: join(directory, '.claude', 'skills') },
      global: { skills: join(directory, '.claude', 'skills') },
    });

    expect(resolveHarnessPaths('opencode', {
      cwd: directory,
      homeDirectory: directory,
    })).toMatchObject({
      project: { skills: join(directory, '.opencode', 'skills') },
      global: { skills: join(directory, '.config', 'opencode', 'skills') },
    });

    expect(resolveHarnessPaths('codex', {
      cwd: directory,
      homeDirectory: directory,
    })).toMatchObject({
      project: { skills: join(directory, '.agents', 'skills') },
      global: { skills: join(directory, '.agents', 'skills') },
    });
  });

  it('honors harness path environment overrides', async () => {
    const directory = await createTemporaryDirectory();
    const claudeHome = join(directory, 'claude');
    const codexHome = join(directory, 'codex');
    const openCodeHome = join(directory, 'opencode');

    expect(resolveHarnessPaths('claude-code', {
      homeDirectory: directory,
      environment: { CLAUDE_CONFIG_DIR: claudeHome },
    }).global.config).toBe(claudeHome);
    expect(resolveHarnessPaths('codex', {
      homeDirectory: directory,
      environment: { CODEX_HOME: codexHome },
    }).global.config).toBe(codexHome);
    expect(resolveHarnessPaths('opencode', {
      homeDirectory: directory,
      environment: { OPENCODE_CONFIG_DIR: openCodeHome },
    }).global.config).toBe(openCodeHome);
  });

  it('detects commands and configured paths without running harnesses', async () => {
    const directory = await createTemporaryDirectory();
    const bin = join(directory, 'bin');
    const claudeConfig = join(directory, '.claude');

    await mkdir(bin, { recursive: true });
    await mkdir(claudeConfig, { recursive: true });
    await writeFile(join(bin, 'codex'), '#!/bin/sh\n', 'utf8');
    await chmod(join(bin, 'codex'), 0o755);

    const detections = await detectHarnesses({
      cwd: directory,
      homeDirectory: directory,
      environment: { PATH: bin },
    });
    const claude = detections.find(({ harness }) => harness === 'claude-code');
    const codex = detections.find(({ harness }) => harness === 'codex');
    const opencode = detections.find(({ harness }) => harness === 'opencode');

    expect(claude).toMatchObject({
      detected: true,
      executable: null,
      project: { configured: true },
    });
    expect(codex).toMatchObject({
      detected: true,
      executable: join(bin, 'codex'),
    });
    expect(opencode).toMatchObject({
      detected: false,
      executable: null,
      project: { configured: false },
      global: { configured: false },
    });
  });

  it('rejects unknown harnesses', () => {
    expect(() => getHarnessDefinition('unknown')).toThrow('Unsupported harness: unknown');
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ai-directory-harness-'));
  temporaryDirectories.push(directory);
  return directory;
}
