import { createHash } from 'node:crypto';
import { join } from 'node:path';

export type UpdatePlatform = 'darwin' | 'linux' | 'win32';
export type UpdateArch = 'x64' | 'arm64';

export type UpdateEnvironment = {
  platform: UpdatePlatform;
  arch: UpdateArch;
  currentVersion: string;
  repository: string;
  binaryPath: string;
  dataDirectory: string;
  gh: (args: string[]) => Promise<string>;
  readFile: (path: string) => Promise<Buffer>;
  writeFile: (path: string, contents: Buffer) => Promise<void>;
  run: (binaryPath: string, args: string[]) => Promise<string>;
  rename: (from: string, to: string) => Promise<void>;
  chmod: (path: string, mode: number) => Promise<void>;
  remove: (path: string) => Promise<void>;
  exists: (path: string) => Promise<boolean>;
  mkdir: (path: string) => Promise<void>;
};

export type UpdateCheck =
  | { status: 'up-to-date'; current: string; latest: string }
  | { status: 'available'; current: string; latest: string; assetName: string; digest: string }
  | { status: 'no-release'; current: string }
  | { status: 'check-failed'; current: string; message: string };

export type UpdateApply =
  | { status: 'applied'; stagedPath: string; version: string }
  | { status: 'staged'; stagedPath: string; version: string }
  | { status: 'apply-failed'; message: string };

export function platformAssetName(platform: UpdatePlatform, arch: UpdateArch): string {
  const osName = platform === 'win32' ? 'windows' : platform;
  return platform === 'win32'
    ? `aid-${osName}-${arch}.exe`
    : `aid-${osName}-${arch}`;
}

export function releaseTagToVersion(tag: string): string {
  return tag.replace(/^v/u, '');
}

export function normalizeDigest(digest: string): string {
  return digest.replace(/^sha256:/u, '').trim().toLowerCase();
}

export function compareVersions(left: string, right: string): -1 | 0 | 1 | null {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  if (!leftParts || !rightParts) return null;
  for (let index = 0; index < 3; index += 1) {
    const a = leftParts[index] ?? 0;
    const b = rightParts[index] ?? 0;
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}

export async function checkForUpdate(environment: UpdateEnvironment): Promise<UpdateCheck> {
  const { gh, currentVersion } = environment;

  let tagName: string;
  try {
    tagName = (await gh([
      'release',
      'view',
      '--repo',
      environment.repository,
      '--json',
      'tagName',
      '--jq',
      '.tagName',
    ])).trim();
  } catch (cause) {
    return { status: 'check-failed', current: currentVersion, message: ghMessage('Could not query the latest release.', asError(cause)) };
  }

  if (!tagName) return { status: 'no-release', current: currentVersion };

  const latest = releaseTagToVersion(tagName);
  const comparison = compareVersions(currentVersion, latest);
  if (comparison === null || comparison >= 0) {
    return { status: 'up-to-date', current: currentVersion, latest };
  }

  const assetName = platformAssetName(environment.platform, environment.arch);

  let digest: string;
  try {
    digest = (await gh([
      'release',
      'view',
      tagName,
      '--repo',
      environment.repository,
      '--json',
      'assets',
      '--jq',
      `.assets[] | select(.name == ${JSON.stringify(assetName)}) | .digest`,
    ])).trim();
  } catch (cause) {
    return { status: 'check-failed', current: currentVersion, message: ghMessage('Could not read the release assets.', asError(cause)) };
  }

  if (!digest) {
    return { status: 'check-failed', current: currentVersion, message: `No ${assetName} asset was found on release ${tagName}.` };
  }

  return { status: 'available', current: currentVersion, latest, assetName, digest };
}

export async function downloadAndStage(environment: UpdateEnvironment, latest: string, assetName: string, digest: string): Promise<UpdateApply> {
  const downloadDirectory = join(environment.dataDirectory, 'download', latest);
  const downloadedPath = join(downloadDirectory, assetName);
  const stagedDirectory = join(environment.dataDirectory, 'staged', latest);
  const stagedPath = join(stagedDirectory, assetName);

  try {
    await environment.mkdir(downloadDirectory);

    // The gh CLI writes the asset into the download directory; this IO is injected
    // so tests can record the requested download and produce a fixture file.
    await environment.gh([
      'release',
      'download',
      `v${latest}`,
      '--repo',
      environment.repository,
      '--pattern',
      assetName,
      '--dir',
      downloadDirectory,
      '--clobber',
    ]);

    const contents = await environment.readFile(downloadedPath);
    const actualDigest = createHash('sha256').update(contents).digest('hex');
    if (actualDigest !== normalizeDigest(digest)) {
      await cleanup(environment, downloadDirectory);
      return { status: 'apply-failed', message: `The downloaded binary does not match the release checksum (expected ${digest}).` };
    }

    await environment.mkdir(stagedDirectory);
    const stagedAlreadyExists = await environment.exists(stagedPath);
    if (stagedAlreadyExists) await environment.remove(stagedPath);
    await environment.writeFile(stagedPath, contents);
    await environment.chmod(stagedPath, 0o755);

    const reportedVersion = await environment.run(stagedPath, ['__selfcheck', '--expected-version', latest]);
    const normalized = reportedVersion.trim().replace(/^v/u, '');
    if (normalized !== latest) {
      await cleanup(environment, downloadDirectory);
      return { status: 'apply-failed', message: `The staged binary reported version ${normalized || 'unknown'}; expected ${latest}.` };
    }

    await cleanup(environment, downloadDirectory);
    return { status: 'staged', stagedPath, version: latest };
  } catch (cause) {
    await cleanup(environment, downloadDirectory).catch(() => undefined);
    return { status: 'apply-failed', message: asError(cause).message };
  }
}

export async function swapIn(environment: UpdateEnvironment, stagedPath: string, version: string): Promise<UpdateApply> {
  const target = environment.binaryPath;

  if (environment.platform === 'win32') {
    // A running Windows executable cannot be replaced in place; the binary is
    // already staged and verified, so tell the user where to swap it manually.
    return { status: 'staged', stagedPath, version };
  }

  const backup = `${target}.previous`;

  try {
    const previousExists = await environment.exists(target);
    if (previousExists) await environment.rename(target, backup);
    await environment.rename(stagedPath, target);
    await environment.chmod(target, 0o755);
    await environment.remove(backup).catch(() => undefined);
    return { status: 'applied', stagedPath: target, version };
  } catch (cause) {
    // Roll the previous binary back into place if the swap partially failed.
    const backupExists = await environment.exists(backup).catch(() => false);
    if (backupExists) await environment.rename(backup, target).catch(() => undefined);
    return { status: 'apply-failed', message: asError(cause).message };
  }
}

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

function parseVersion(value: string): readonly [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(value.trim());
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (!Number.isInteger(major) || !Number.isInteger(minor) || !Number.isInteger(patch)) return null;
  return [major, minor, patch] as const;
}

function ghMessage(message: string, cause: Error): string {
  const match = /gh: (.+)/u.exec(cause.message);
  const short = match?.[1] ?? cause.message.split('\n')[0] ?? '';
  return short ? `${message} ${short}` : message;
}

async function cleanup(environment: UpdateEnvironment, directory: string): Promise<void> {
  await environment.remove(directory).catch(() => undefined);
}
