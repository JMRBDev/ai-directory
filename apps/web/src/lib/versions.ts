export type VersionComparison = 'same' | 'server-behind' | 'server-ahead' | 'unknown';

/** Compare two semver-ish strings. Returns -1/0/1; null when either is not parseable. */
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

export function serverVersionStatus(serverVersion: string | null, siteVersion: string): VersionComparison {
  if (!serverVersion) return 'unknown';
  const result = compareVersions(serverVersion, siteVersion);
  if (result === null) return 'unknown';
  if (result === 0) return 'same';
  return result < 0 ? 'server-behind' : 'server-ahead';
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
