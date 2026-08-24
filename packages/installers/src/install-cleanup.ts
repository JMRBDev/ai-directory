import { rm, rmdir } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import { isMissingPathError, writeFileAtomic } from '@ai-directory/config';
import { applyEdits, modify } from 'jsonc-parser';
import { parseMarketplace, removeCodexMarketplacePlugin } from './codex-marketplace.js';
import { hashContent, hashFile } from './hashing.js';
import type { InstallChange, InstallOptions } from './install-types.js';
import { isPluginBundleType, selectHashes } from './install-plans.js';
import {
  willRemoveInstallation,
  type InstallationRecord,
} from './installation-records.js';
import { codexInstallPaths } from './plans/codex.js';
import {
  isEmptyOpenCodeConfig,
  openCodeConfigPath,
  openCodeInstallRoot,
  readOpenCodeInstructions,
} from './opencode-config.js';
import { currentFile } from './file-snapshots.js';
import { isPathWithin, toPosixPath } from './paths.js';
import { resourceType } from './resources.js';

export async function removeStaleInstallationFiles(
  previous: InstallationRecord[],
  currentFiles: string[],
  options?: InstallOptions,
): Promise<void> {
  const keep = new Set(currentFiles);

  for (const record of previous) {
    const files = await ownedInstallationFiles(record, options);
    const stale = files.filter((path) => !keep.has(path));

    if (stale.length === 0) continue;

    const staleRecord: InstallationRecord = {
      ...record,
      files: stale,
    };
    if (record.fileHashes) {
      staleRecord.fileHashes = selectHashes(stale, record.fileHashes);
    }

    await assertInstallationFilesUnchanged(staleRecord, options?.force ?? false);
    await Promise.all(stale.map((path) => rm(path, { force: true })));
    await removeEmptyInstallationDirectories(staleRecord, stale);
  }
}

async function removeEmptyInstallationDirectories(
  record: InstallationRecord,
  files: string[],
): Promise<void> {
  const destination = resolve(record.destination);
  const roots = new Set<string>();

  if (files.some((path) => isPathWithin(resolve(path), destination) && resolve(path) !== destination)) {
    roots.add(destination);
  }

  for (const path of files) {
    let current = dirname(resolve(path));
    while (current !== dirname(current)) {
      if (basename(current).endsWith('.files')) {
        roots.add(current);
        break;
      }
      current = dirname(current);
    }
  }

  for (const root of roots) {
    for (const path of files) {
      const resolvedPath = resolve(path);
      if (!isPathWithin(resolvedPath, root) || resolvedPath === root) continue;

      let current = dirname(resolvedPath);
      while (isPathWithin(current, root)) {
        try {
          await rmdir(current);
        } catch (error) {
          if (isMissingPathError(error)) break;
          const code = error instanceof Error && 'code' in error
            ? error.code
            : undefined;
          if (code === 'ENOTEMPTY' || code === 'EEXIST') break;
          throw error;
        }
        if (current === root) break;
        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
      }
    }
  }
}

async function ownedInstallationFiles(
  record: InstallationRecord,
  options?: InstallOptions,
): Promise<string[]> {
  if (record.fileHashes) return record.files;

  const files = new Set(record.files);
  const type = resourceType(record.resource);

  if (type === 'rules' && record.harness === 'codex') {
    files.delete(record.destination);
  }

  if (type === 'rules' && record.harness === 'opencode') {
    const installOptions = options ?? {};
    const root = openCodeInstallRoot(installOptions);
    const configPath = await openCodeConfigPath(root, installOptions);
    files.delete(configPath);
  }

  return [...files];
}

async function removeSharedConfiguration(
  record: InstallationRecord,
  options: InstallOptions,
): Promise<InstallChange[]> {
  const type = resourceType(record.resource);

  if (isPluginBundleType(type) && record.harness === 'codex') {
    const change = await removeCodexMarketplaceEntry(record, options);
    return change ? [change] : [];
  }

  if (type !== 'rules') return [];

  if (record.harness === 'opencode') {
    const change = await removeOpenCodeInstruction(record, options);
    return change ? [change] : [];
  } else if (record.harness === 'codex') {
    const change = await removeCodexGuidance(record, options);
    return change ? [change] : [];
  }

  return [];
}

async function removeOpenCodeInstruction(
  record: InstallationRecord,
  options: InstallOptions,
): Promise<InstallChange | null> {
  const root = openCodeInstallRoot(options);
  const path = await openCodeConfigPath(root, options);
  const current = await currentFile(path);

  if (current === null) return null;

  const currentInstructions = readOpenCodeInstructions(current, path);
  if (!currentInstructions) return null;

  const entry = toPosixPath(relative(dirname(path), record.destination));
  if (!currentInstructions.includes(entry)) return null;

  const ownership = record.shared?.find((item) => item.path === path && item.key === record.resource);
  if (record.shared && !ownership) return null;

  const content = applyEdits(
    current,
    modify(
      current,
      ['instructions'],
      currentInstructions.filter((value) => value !== entry),
      { formattingOptions: { insertSpaces: true, tabSize: 2 } },
    ),
  );

  return {
    path,
    content: ownership?.created && isEmptyOpenCodeConfig(content) ? null : content,
  };
}

async function removeCodexGuidance(
  record: InstallationRecord,
  options: InstallOptions,
): Promise<InstallChange | null> {
  const current = await currentFile(record.destination);

  if (current === null) return null;

  const key = record.resource;
  const startMarker = `<!-- ai-directory:rule:${key} -->`;
  const endMarker = `<!-- /ai-directory:rule:${key} -->`;
  const start = current.indexOf(startMarker);
  const end = current.indexOf(endMarker);

  if (start === -1 && end === -1) return null;

  if ((start === -1) !== (end === -1) || end < start) {
    throw new Error(`Codex managed rule block is malformed: ${key}`);
  }

  const ownership = record.shared?.find((item) => item.path === record.destination && item.key === key);
  if (record.shared && !ownership) return null;

  const block = current.slice(start, end + endMarker.length);
  if (ownership && hashContent(block) !== ownership.hash && !options.force) {
    throw new Error(`Codex managed rule block was modified: ${key}. Use --force to continue.`);
  }

  const before = current.slice(0, start);
  const after = current.slice(end + endMarker.length);
  const cleanedBefore = before.endsWith('\n\n') ? before.slice(0, -1) : before;
  const cleanedAfter = after.startsWith('\n') ? after.slice(1) : after;
  const content = `${cleanedBefore}${cleanedAfter}`;
  return {
    path: record.destination,
    content: ownership?.created && content.trim() === '' ? null : content,
  };
}

async function removeCodexMarketplaceEntry(
  record: InstallationRecord,
  options: InstallOptions,
): Promise<InstallChange | null> {
  const paths = codexInstallPaths(options);
  const current = await currentFile(paths.marketplacePath);

  if (current === null) return null;

  const name = record.resource.split('/').at(-1) ?? record.resource;
  const ownership = record.shared?.find((item) => item.path === paths.marketplacePath && item.key === record.resource);
  if (record.shared && !ownership) return null;

  if (ownership) {
    const data = parseMarketplace(current, paths.marketplacePath);
    const existing = data.plugins?.find((plugin) => plugin.name === name);
    if (existing && hashContent(JSON.stringify(existing)) !== ownership.hash && !options.force) {
      throw new Error(`Codex marketplace entry was modified: ${name}. Use --force to continue.`);
    }
  }

  const removal = removeCodexMarketplacePlugin(current, name, paths.marketplacePath);

  if (!removal.changed) return null;

  if (ownership?.created) {
    const remaining = parseMarketplace(removal.content, paths.marketplacePath);
    const keys = Object.keys(remaining);
    if (
      keys.every((key) => key === 'name' || key === 'plugins')
      && (remaining.plugins?.length ?? 0) === 0
      && (remaining.name === undefined || remaining.name === 'ai-directory')
    ) {
      return { path: paths.marketplacePath, content: null };
    }
  }

  return { path: paths.marketplacePath, content: removal.content };
}

export async function assertInstallationFilesUnchanged(
  record: InstallationRecord,
  force = false,
): Promise<void> {
  if (force) return;

  if (!record.fileHashes) {
    throw new Error(
      `Installation ${record.resource} has no ownership hashes. Reinstall it with --force before updating or uninstalling.`,
    );
  }

  const changed: string[] = [];

  for (const path of record.files) {
    const expected = record.fileHashes[path];
    if (!expected) {
      changed.push(path);
      continue;
    }

    const actual = await hashFile(path);
    if (actual !== null && actual !== expected) changed.push(path);
  }

  if (changed.length > 0) {
    throw new Error(
      `Installation files were modified: ${changed.join(', ')}. Use --force to continue.`,
    );
  }
}

export async function uninstallInstallation(
  record: InstallationRecord,
  options: InstallOptions,
): Promise<InstallChange[]> {
  if (options.installationOwner && !willRemoveInstallation(record, options.installationOwner)) {
    return [];
  }

  const files = await ownedInstallationFiles(record, options);
  const normalized: InstallationRecord = {
    ...record,
    files,
  };
  if (record.fileHashes) {
    normalized.fileHashes = selectHashes(files, record.fileHashes);
  }

  await assertInstallationFilesUnchanged(normalized, options.force ?? false);
  const sharedChanges = await removeSharedConfiguration(record, options);

  if (!options.dryRun) {
    for (const change of sharedChanges) {
      if (change.content === null) await rm(change.path, { force: true });
      else await writeFileAtomic(change.path, change.content);
    }
    await Promise.all(files.map((path) => rm(path, { force: true })));
    await removeEmptyInstallationDirectories(record, files);
  }

  return [
    ...sharedChanges,
    ...files.map((path) => ({ path, content: null })),
  ];
}
