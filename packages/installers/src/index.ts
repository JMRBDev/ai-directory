import { access, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { ResourceVersion } from '@ai-directory/registry';

export type InstallScope = 'project' | 'global';

export type ClaudeCodeInstallOptions = {
  scope: InstallScope;
  cwd?: string;
  homeDirectory?: string;
  force?: boolean;
};

export type InstallResult = {
  destination: string;
  files: string[];
};

export async function installClaudeCodeResource(
  resource: ResourceVersion,
  options: ClaudeCodeInstallOptions,
): Promise<InstallResult> {
  if (resource.resource.type !== 'skills') {
    throw new Error('Claude Code installation currently supports skills only.');
  }

  const root =
    options.scope === 'project'
      ? options.cwd ?? process.cwd()
      : options.homeDirectory ?? homedir();
  const destination = join(root, '.claude', 'skills', resource.resource.name);
  const files = resource.files.map((file) => ({
    ...file,
    destination: safeDestination(destination, file.path),
  }));

  if (!options.force) {
    const existing = [];

    for (const file of files) {
      if (await pathExists(file.destination)) {
        existing.push(file.path);
      }
    }

    if (existing.length > 0) {
      throw new Error(
        `Install destination already contains files: ${existing.join(', ')}. Use --force to overwrite.`,
      );
    }
  }

  for (const file of files) {
    await mkdir(dirname(file.destination), { recursive: true });
    await writeFile(file.destination, file.content, 'utf8');
  }

  return {
    destination,
    files: resource.files.map((file) => file.path),
  };
}

function safeDestination(root: string, resourcePath: string): string {
  const destination = resolve(root, resourcePath);
  const relativePath = relative(resolve(root), destination);

  if (!relativePath || isAbsolute(relativePath) || relativePath.startsWith('..')) {
    throw new Error(`Unsafe resource file path: ${resourcePath}`);
  }

  return destination;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }

    throw error;
  }
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
