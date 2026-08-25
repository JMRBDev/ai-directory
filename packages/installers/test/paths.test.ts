import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPathWithin, pathsOverlap, toPosixPath } from '../src/paths.js';

describe('paths', () => {
  it('detects containment with isPathWithin', () => {
    const root = resolve('/tmp/root');

    expect(isPathWithin(root, root)).toBe(true);
    expect(isPathWithin(join(root, 'skills', 'SKILL.md'), root)).toBe(true);
    expect(isPathWithin(root, join(root, 'skills'))).toBe(false);
    expect(isPathWithin(join(root, 'other', 'SKILL.md'), join(root, 'skills'))).toBe(false);
  });

  it('does not treat sibling prefixes as overlapping', () => {
    const parent = resolve('/tmp/resources');
    const directory = join(parent, 'typescript-review');
    const sibling = join(parent, 'typescript-review-notes');

    expect(pathsOverlap(directory, sibling)).toBe(false);
    expect(isPathWithin(join(sibling, 'SKILL.md'), directory)).toBe(false);
  });

  it('detects overlap in both directions and normalizes traversal', () => {
    const root = resolve('/tmp/root');
    const nested = join(root, 'nested');

    expect(pathsOverlap(root, nested)).toBe(true);
    expect(pathsOverlap(nested, root)).toBe(true);
    expect(pathsOverlap(join(root, 'nested', '..', 'file.md'), join(root, 'file.md'))).toBe(true);
    expect(pathsOverlap(resolve('/tmp/root'), resolve('/tmp/root'))).toBe(true);
    expect(pathsOverlap(resolve('/tmp/root'), resolve('/tmp/other'))).toBe(false);
  });

  it('converts path separators to posix', () => {
    expect(toPosixPath(join('a', 'b', 'c'))).toBe('a/b/c');
  });
});
