import { describe, expect, it } from 'vitest';
import { folderPathFor } from '../src/features/directory/folder-picker';
import type { DirectoryFile } from '../src/features/directory/model';

function file(name: string, webkitRelativePath?: string): DirectoryFile {
  const file = new File(['# Review\n'], name);
  if (webkitRelativePath) Object.defineProperty(file, 'webkitRelativePath', { value: webkitRelativePath });
  return file;
}

describe('folderPathFor', () => {
  it('drops the webkit directory prefix from a relative path', () => {
    expect(folderPathFor(file('SKILL.md', 'my-resource/SKILL.md'))).toBe('SKILL.md');
  });

  it('keeps nested paths below the folder root', () => {
    expect(folderPathFor(file('checklist.md', 'my-resource/references/checklist.md'))).toBe(
      'references/checklist.md',
    );
  });

  it('uses the file name when there is no directory prefix', () => {
    expect(folderPathFor(file('SKILL.md'))).toBe('SKILL.md');
  });

  it('returns a bare file name when the path has a single segment', () => {
    expect(folderPathFor(file('SKILL.md', 'SKILL.md'))).toBe('SKILL.md');
  });
});
