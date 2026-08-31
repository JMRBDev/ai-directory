import { mkdtemp, rm, readFile, writeFile, mkdir, rename as fsRename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkForUpdate,
  compareVersions,
  downloadAndStage,
  platformAssetName,
  releaseTagToVersion,
  swapIn,
  type UpdateEnvironment,
} from '../src/self-update/updater';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'aid-updater-'));
  temporaryDirectories.push(directory);
  return directory;
}

type RecordingEnvironment = UpdateEnvironment & { ghCalls: string[][] };

async function baseEnvironment(overrides: Partial<UpdateEnvironment> = {}): Promise<RecordingEnvironment> {
  const dataDirectory = await temporaryDirectory();
  const ghCalls: string[][] = [];
  const contents = Buffer.from('staged-binary-contents');
  const digest = createHash('sha256').update(contents).digest('hex');

  const environment: RecordingEnvironment = {
    platform: 'darwin',
    arch: 'arm64',
    currentVersion: '0.1.0',
    repository: 'JMRBDev/ai-directory',
    binaryPath: join(dataDirectory, 'aid'),
    dataDirectory,
    ghCalls,
    gh: async (args) => {
      ghCalls.push(args);
      if (args[0] === 'release' && args[1] === 'view' && args.some((arg) => arg.includes('.tagName'))) {
        return 'v0.2.0\n';
      }
      if (args[0] === 'release' && args[1] === 'view' && args.some((arg) => arg.includes('.assets[]'))) {
        return `${digest}\n`;
      }
      if (args[0] === 'release' && args[1] === 'download') {
        await mkdir(args[args.indexOf('--dir') + 1] ?? '', { recursive: true });
        const dir = args[args.indexOf('--dir') + 1];
        const name = args[args.indexOf('--pattern') + 1];
        if (dir && name) await writeFile(join(dir, name), contents);
        return '';
      }
      throw new Error(`Unexpected gh call: ${args.join(' ')}`);
    },
    readFile: async (path) => readFile(path),
    writeFile: async (path, contentsToWrite) => { await writeFile(path, contentsToWrite); },
    run: async () => '0.2.0',
    rename: async (from, to) => fsRename(from, to),
    chmod: async () => undefined,
    remove: async (path) => { await rm(path, { recursive: true, force: true }); },
    exists: async (path) => {
      try {
        await readFile(path);
        return true;
      } catch {
        return false;
      }
    },
    mkdir: async (path) => { await mkdir(path, { recursive: true }); },
    ...overrides,
  };
  return environment;
}

describe('platformAssetName', () => {
  it('names assets per OS and arch', () => {
    expect(platformAssetName('darwin', 'arm64')).toBe('aid-darwin-arm64');
    expect(platformAssetName('darwin', 'x64')).toBe('aid-darwin-x64');
    expect(platformAssetName('linux', 'x64')).toBe('aid-linux-x64');
    expect(platformAssetName('win32', 'x64')).toBe('aid-windows-x64.exe');
  });
});

describe('releaseTagToVersion', () => {
  it('strips the leading v', () => {
    expect(releaseTagToVersion('v1.2.3')).toBe('1.2.3');
    expect(releaseTagToVersion('0.1.0')).toBe('0.1.0');
  });
});

describe('compareVersions', () => {
  it('compares major, minor, and patch', () => {
    expect(compareVersions('0.1.0', '0.2.0')).toBe(-1);
    expect(compareVersions('0.2.0', '0.1.0')).toBe(1);
    expect(compareVersions('1.0.0', '0.9.9')).toBe(1);
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
  });

  it('returns null for unparseable input', () => {
    expect(compareVersions('nope', '0.1.0')).toBeNull();
  });
});

describe('checkForUpdate', () => {
  it('reports available when the release is newer and the asset exists', async () => {
    const environment = await baseEnvironment();
    const result = await checkForUpdate(environment);

    expect(result).toEqual({
      status: 'available',
      current: '0.1.0',
      latest: '0.2.0',
      assetName: 'aid-darwin-arm64',
      digest: createHash('sha256').update(Buffer.from('staged-binary-contents')).digest('hex'),
    });
  });

  it('reports up-to-date when the current version matches the release', async () => {
    const environment = await baseEnvironment({ currentVersion: '0.2.0' });
    const result = await checkForUpdate(environment);
    expect(result).toEqual({ status: 'up-to-date', current: '0.2.0', latest: '0.2.0' });
  });

  it('reports check-failed when gh is unavailable', async () => {
    const environment = await baseEnvironment({
      gh: async () => { throw new Error('gh: not logged in'); },
    });
    const result = await checkForUpdate(environment);
    expect(result.status).toBe('check-failed');
    if (result.status === 'check-failed') expect(result.message).toContain('not logged in');
  });

  it('reports a missing asset clearly', async () => {
    const environment = await baseEnvironment({
      gh: async (args) => {
        if (args[0] === 'release' && args[1] === 'view' && args.some((arg) => arg.includes('.tagName'))) return 'v0.2.0\n';
        return '\n';
      },
    });
    const result = await checkForUpdate(environment);
    expect(result).toMatchObject({ status: 'check-failed' });
  });
});

describe('downloadAndStage', () => {
  it('downloads, verifies the digest, self-checks, and stages the binary', async () => {
    const environment = await baseEnvironment();
    const contents = Buffer.from('staged-binary-contents');
    const digest = createHash('sha256').update(contents).digest('hex');
    const result = await downloadAndStage(environment, '0.2.0', 'aid-darwin-arm64', digest);

    expect(result.status).toBe('staged');
    if (result.status !== 'staged') return;
    expect(result.version).toBe('0.2.0');
    const staged = await readFile(result.stagedPath, 'utf8');
    expect(staged).toBe('staged-binary-contents');
  });

  it('rejects a binary that does not match the digest', async () => {
    const environment = await baseEnvironment();
    const result = await downloadAndStage(
      environment,
      '0.2.0',
      'aid-darwin-arm64',
      'f'.repeat(64),
    );
    expect(result.status).toBe('apply-failed');
    if (result.status === 'apply-failed') expect(result.message).toContain('checksum');
  });

  it('rejects a staged binary that self-checks to the wrong version', async () => {
    const environment = await baseEnvironment({
      run: async () => '0.0.9',
    });
    const contents = Buffer.from('staged-binary-contents');
    const digest = createHash('sha256').update(contents).digest('hex');
    const result = await downloadAndStage(environment, '0.2.0', 'aid-darwin-arm64', digest);
    expect(result.status).toBe('apply-failed');
  });
});

describe('swapIn', () => {
  it('swaps the staged binary into the target and keeps a rollback path', async () => {
    const environment = await baseEnvironment();
    await writeFile(environment.binaryPath, 'old');
    const stagedPath = join(environment.dataDirectory, 'staged', '0.2.0', 'aid-darwin-arm64');
    await mkdir(join(environment.dataDirectory, 'staged', '0.2.0'), { recursive: true });
    await writeFile(stagedPath, 'new');

    const result = await swapIn(environment, stagedPath, '0.2.0');
    expect(result.status).toBe('applied');
    expect(await readFile(environment.binaryPath, 'utf8')).toBe('new');
  });

  it('returns staged (no in-place swap) on Windows', async () => {
    const environment = await baseEnvironment({ platform: 'win32' });
    const result = await swapIn(environment, join(environment.dataDirectory, 'aid.exe'), '0.2.0');
    expect(result.status).toBe('staged');
  });
});
