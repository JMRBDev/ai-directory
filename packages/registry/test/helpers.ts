import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const fixturePath = fileURLToPath(new URL('./fixtures/index.json', import.meta.url));
export const invalidIndexPath = fileURLToPath(new URL('./fixtures/invalid-index.json', import.meta.url));
export const duplicateIndexPath = fileURLToPath(new URL('./fixtures/duplicate-index.json', import.meta.url));
export const templateIndexPath = fileURLToPath(new URL('./fixtures/template-index.json', import.meta.url));
export const mcpIndexPath = fileURLToPath(new URL('./fixtures/mcp-index.json', import.meta.url));

const temporaryDirectories: string[] = [];

export async function createTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

export function cleanupTemporaryDirectories(): Promise<void> {
  return Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  ).then(() => undefined);
}

export async function createPublishFixture(): Promise<{
  indexPath: string;
  sourceDirectory: string;
  registryRoot: string;
}> {
  const registryRoot = await createTemporaryDirectory('ai-directory-publish-');

  const indexPath = join(registryRoot, 'index.json');
  const sourceDirectory = join(registryRoot, 'source');

  await mkdir(sourceDirectory, { recursive: true });
  await writeFile(
    indexPath,
    JSON.stringify({ schemaVersion: 1, resources: [] }, null, 2),
    'utf8',
  );

  return { indexPath, sourceDirectory, registryRoot };
}
