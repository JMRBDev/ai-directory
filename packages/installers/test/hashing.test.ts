import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fingerprintPaths, hashContent, hashFile } from '../src/hashing.js';
import { cleanupTemporaryDirectories, createTemporaryDirectory } from './fixtures.js';

afterEach(cleanupTemporaryDirectories);

describe('hashing', () => {
  it('hashes content with sha256', () => {
    expect(hashContent('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hashContent('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('reads missing files as null and existing files as their content hash', async () => {
    const directory = await createTemporaryDirectory();
    const path = join(directory, 'SKILL.md');
    await writeFile(path, 'abc', 'utf8');

    await expect(hashFile(path)).resolves.toBe(hashContent('abc'));
    await expect(hashFile(join(directory, 'missing.md'))).resolves.toBeNull();
  });

  it('fingerprints paths independent of order and duplicates but sensitive to content', async () => {
    const directory = await createTemporaryDirectory();
    const first = join(directory, 'first.md');
    const second = join(directory, 'second.md');
    const missing = join(directory, 'missing.md');
    await writeFile(first, 'one\n', 'utf8');
    await writeFile(second, 'two\n', 'utf8');

    const fingerprint = await fingerprintPaths([first, second]);
    await expect(fingerprintPaths([second, first, first])).resolves.toBe(fingerprint);

    await writeFile(first, 'changed\n', 'utf8');
    await expect(fingerprintPaths([first, second])).resolves.not.toBe(fingerprint);

    await expect(fingerprintPaths([missing])).resolves.toBe(await fingerprintPaths([missing]));
  });
});
