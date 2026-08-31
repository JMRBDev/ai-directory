import { describe, expect, it } from 'vitest';
import { compareVersions, serverVersionStatus } from '../src/lib/versions';

describe('compareVersions', () => {
  it('compares major, minor, and patch', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.3.0', '1.2.9')).toBe(1);
    expect(compareVersions('1.2.4', '1.2.3')).toBe(1);
    expect(compareVersions('1.2.3', '1.2.4')).toBe(-1);
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
  });

  it('ignores prerelease and build suffixes on the numeric part', () => {
    expect(compareVersions('1.2.3-beta.1', '1.2.3')).toBe(0);
    expect(compareVersions('1.2.3', '1.2.3+build')).toBe(0);
  });

  it('returns null for unparseable versions', () => {
    expect(compareVersions('not-a-version', '1.2.3')).toBeNull();
    expect(compareVersions('1.2.3', '')).toBeNull();
  });
});

describe('serverVersionStatus', () => {
  const site = '1.2.3';

  it('reports same, server-behind, and server-ahead', () => {
    expect(serverVersionStatus('1.2.3', site)).toBe('same');
    expect(serverVersionStatus('1.2.2', site)).toBe('server-behind');
    expect(serverVersionStatus('1.3.0', site)).toBe('server-ahead');
  });

  it('reports unknown when the server version is missing or unparseable', () => {
    expect(serverVersionStatus(null, site)).toBe('unknown');
    expect(serverVersionStatus('weird', site)).toBe('unknown');
  });
});
