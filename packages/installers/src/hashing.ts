import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isMissingPathError } from '@ai-directory/config';
import { currentFile } from './file-snapshots.js';

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function hashFile(path: string): Promise<string | null> {
  try {
    return hashContent(await readFile(path, 'utf8'));
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
}

export async function fingerprintPaths(paths: string[]): Promise<string> {
  const state = [];

  for (const path of [...new Set(paths)].sort()) {
    state.push([path, await currentFile(path)] as const);
  }

  return createHash('sha256').update(JSON.stringify(state)).digest('hex');
}
