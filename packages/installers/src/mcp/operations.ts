import { rm } from 'node:fs/promises';
import { getScopeInstallManifestPath, writeFileAtomic, type ConfigScope } from '@ai-directory/config';
import { resourceKey } from '@ai-directory/contracts';
import { readMcpServerManifest } from '@ai-directory/registry';
import { applyChangePlanEnvelope } from '../change-envelope.js';
import { currentFile } from '../file-snapshots.js';
import { fingerprintPaths, hashContent } from '../hashing.js';
import type { Harness } from '../harnesses.js';
import {
  readInstallationManifest,
  removeInstallationRecord,
  updateInstallationManifest,
  type InstallationRecord,
} from '../installation-records.js';
import type { ResourceChangeOptions } from '../resource-operation-types.js';
import { publicOperation, requestWarnings } from '../resource-operations.js';
import { mcpConfigPath } from './config-paths.js';
import { isEmptyMcpConfig } from './discovery.js';
import { envNotesFor, mcpEntryFor, validateServerName } from './entries.js';
import { containerKey, readJsonEntry, removeJsonEntry, upsertJsonEntry } from './json-config.js';
import { readTomlEntry, removeTomlBlock, upsertTomlBlock } from './toml-config.js';
import type {
  JsonValue,
  McpApplyResult,
  McpChange,
  McpOperation,
  McpPlan,
  McpServerEntry,
  RemovalResult,
} from './types.js';

export async function planMcpOperations(
  operations: McpOperation[],
  options: ResourceChangeOptions = {},
  force = false,
): Promise<McpPlan> {
  const scope = operationScope(operations, options);
  const environment = { ...process.env, ...options.environment };
  const changes: McpChange[] = [];
  const conflicts: string[] = [];
  const warnings: string[] = [];
  const envNotes: string[] = [];
  const contents = new Map<string, string | null>();
  const manifestPath = getScopeInstallManifestPath(scope, options.cwd, options.homeDirectory);
  const manifest = await readInstallationManifest(manifestPath);

  for (const operation of operations) {
    warnings.push(...requestWarnings(operation.warningResources ?? []));

    for (const harness of operation.harnesses) {
      const path = await mcpConfigPath(harness, scope, options);
      let content = (await contentFor(path, contents)) ?? '';

      if (operation.action === 'install') {
        const resources = operation.resources ?? [];
        if (resources.length === 0) {
          throw new Error(`MCP install operation has no resources: ${operation.resource}.`);
        }

        for (const resource of resources) {
          const serverManifest = readMcpServerManifest(resource);
          const server = resource.resource.name;
          const resourceId = resourceKey(resource.resource);
          const record = manifest.installations.find(
            (item) => item.harness === harness && item.resource === resourceId,
          );

          validateServerName(harness, server);

          const result = mcpEntryFor(harness, serverManifest);
          warnings.push(...result.notes);

          const existing = readEntry(harness, content, path, server);
          content = upsertEntry(harness, content, path, server, result.entry);

          if (existing === undefined) {
            changes.push(change(resourceId, harness, server, path, 'added', undefined, result.entry));
          } else if (record?.fileHashes?.[path] === entryHash(existing)) {
            changes.push(change(resourceId, harness, server, path, 'modified', existing, result.entry));
          } else if (record?.fileHashes && !force) {
            conflicts.push(
              `MCP server ${server} was modified after installation (${path}). Use --force to overwrite.`,
            );
            changes.push(change(resourceId, harness, server, path, 'modified', existing, result.entry));
          } else if (!force) {
            conflicts.push(
              `MCP server ${server} already exists in ${path}. Use --force to overwrite.`,
            );
            changes.push(change(resourceId, harness, server, path, 'modified', existing, result.entry));
          } else {
            changes.push(change(resourceId, harness, server, path, 'modified', existing, result.entry));
          }

          envNotes.push(...envNotesFor(server, serverManifest, environment));
        }

        contents.set(path, content);
      } else {
        const resourceIds = operation.resourceIds ?? [];
        const records = manifest.installations.filter(
          (item) => item.harness === harness && resourceIds.includes(item.resource),
        );

        for (const record of records) {
          const server = resourceName(record.resource);
          const existing = readEntry(harness, content, path, server);

          if (existing === undefined) {
            conflicts.push(
              `MCP entry for ${server} is already absent from ${path}. Use --force to continue.`,
            );
            continue;
          }

          const expected = record.fileHashes?.[path];
          if (expected !== undefined && entryHash(existing) !== expected && !force) {
            conflicts.push(
              `MCP entry for ${server} in ${path} was modified. Use --force to continue.`,
            );
          }

          changes.push(change(record.resource, harness, server, path, 'removed', existing, undefined));
        }
      }
    }
  }

  const affectedPaths = [
    ...new Set([...changes.map((change) => change.path), manifestPath]),
  ];

  return {
    operations: operations.map(publicOperation),
    changes,
    conflicts: [...new Set(conflicts)],
    warnings: [...new Set(warnings)],
    envNotes: [...new Set(envNotes)],
    projectionNotes: [],
    fingerprint: await fingerprintPaths(affectedPaths),
  };
}

export async function applyMcpOperations(
  operations: McpOperation[],
  options: ResourceChangeOptions = {},
  force = false,
  planned?: McpPlan,
): Promise<McpApplyResult> {
  const scope = operationScope(operations, options);
  const scopedOptions: ResourceChangeOptions = { ...options, scope };
  const manifestPath = getScopeInstallManifestPath(scope, options.cwd, options.homeDirectory);

  return applyChangePlanEnvelope(
    operations,
    scopedOptions,
    force,
    planned,
    () => planMcpOperations(operations, scopedOptions, force),
    (plan) => [...new Set([...plan.changes.map((change) => change.path), manifestPath])],
    async (plan) => {
      const installed: InstallationRecord[] = [];
      const removed: InstallationRecord[] = [];

      for (const operation of operations) {
        for (const harness of operation.harnesses) {
          if (operation.action === 'install') {
            const resources = operation.resources ?? [];
            const path = await mcpConfigPath(harness, scope, options);
            const existingContent = await currentFile(path);
            let content = existingContent ?? '';
            const manifest = await readInstallationManifest(manifestPath);
            const records: InstallationRecord[] = [];

            for (const resource of resources) {
              const serverManifest = readMcpServerManifest(resource);
              const server = resource.resource.name;
              const result = mcpEntryFor(harness, serverManifest);
              content = upsertEntry(harness, content, path, server, result.entry);
              const persisted = readEntry(harness, content, path, server);
              const resourceId = resourceKey(resource.resource);
              const previous = manifest.installations.find(
                (item) => item.harness === harness && item.resource === resourceId,
              );
              const previousOwnership = previous?.shared?.find(
                (item) => item.path === path && item.key === resourceId,
              );

              records.push({
                resource: resourceId,
                version: resource.version,
                harness,
                destination: path,
                files: [path],
                fileHashes: { [path]: entryHash(persisted) },
                shared: [{
                  path,
                  key: resourceId,
                  hash: entryHash(persisted),
                  created: previousOwnership?.created ?? existingContent === null,
                }],
                kind: 'mcp',
                scope,
                installedAt: new Date().toISOString(),
              });
            }

            await writeFileAtomic(path, content);
            await updateInstallationManifest(manifestPath, records);
            installed.push(...records);
          } else {
            const resourceIds = operation.resourceIds ?? [];
            const manifest = await readInstallationManifest(manifestPath);
            const records = manifest.installations.filter(
              (item) => item.harness === harness && resourceIds.includes(item.resource),
            );

            for (const record of records) {
              await assertMcpEntryUnchanged(record, force);
              const path = record.destination;
              const content = await currentFile(path);

              if (content !== null) {
                const removal = removeEntry(harness, content, path, resourceName(record.resource));
                if (removal.changed) {
                  const ownership = record.shared?.find(
                    (item) => item.path === path && item.key === record.resource,
                  );
                  if (ownership?.created && isEmptyMcpConfig(harness, removal.content, path)) {
                    await rm(path, { force: true });
                  } else {
                    await writeFileAtomic(path, removal.content);
                  }
                }
              }

              await removeInstallationRecord(manifestPath, record);
              removed.push(record);
            }
          }
        }
      }

      return {
        plan,
        installed,
        removed,
        warnings: [...new Set([...plan.warnings, ...plan.envNotes])],
      };
    },
    'MCP installation failed',
  );
}

async function assertMcpEntryUnchanged(
  record: InstallationRecord,
  force: boolean,
): Promise<void> {
  if (force) return;

  const expected = record.fileHashes?.[record.destination];
  if (!expected) {
    throw new Error(
      `MCP installation ${record.resource} has no ownership hash. Reinstall it with --force before updating or uninstalling.`,
    );
  }

  const content = await currentFile(record.destination);
  if (content === null) return;

  const existing = readEntry(
    record.harness,
    content,
    record.destination,
    resourceName(record.resource),
  );
  if (existing !== undefined && entryHash(existing) !== expected) {
    throw new Error(
      `MCP entry for ${resourceName(record.resource)} was modified. Use --force to continue.`,
    );
  }
}

function operationScope(
  operations: McpOperation[],
  options: ResourceChangeOptions,
): ConfigScope {
  return options.scope ?? operations[0]?.scope ?? 'user';
}

function upsertEntry(
  harness: Harness,
  content: string,
  path: string,
  server: string,
  entry: McpServerEntry,
): string {
  return harness === 'codex'
    ? upsertTomlBlock(content, server, entry)
    : upsertJsonEntry(content, containerKey(harness), server, entry, path);
}

function readEntry(
  harness: Harness,
  content: string,
  path: string,
  server: string,
): JsonValue | undefined {
  return harness === 'codex'
    ? readTomlEntry(content, server)
    : readJsonEntry(content, containerKey(harness), server, path);
}

function removeEntry(
  harness: Harness,
  content: string,
  path: string,
  server: string,
): RemovalResult {
  return harness === 'codex'
    ? removeTomlBlock(content, server)
    : removeJsonEntry(content, containerKey(harness), server, path);
}

function change(
  resource: string,
  harness: Harness,
  server: string,
  path: string,
  action: McpChange['action'],
  before: JsonValue | undefined,
  after: McpServerEntry | undefined,
): McpChange {
  const result: McpChange = { path, action, resource, harness, server };
  const beforePreview = previewValue(before);
  const afterPreview = previewValue(after);
  if (beforePreview !== undefined) result.before = beforePreview;
  if (afterPreview !== undefined) result.after = afterPreview;
  return result;
}

function previewValue(value: JsonValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  const serialized = JSON.stringify(value, null, 2);
  return serialized === undefined ? undefined : serialized;
}

function entryHash(entry: JsonValue | undefined): string {
  return hashContent(JSON.stringify(entry ?? null));
}

async function contentFor(
  path: string,
  contents: Map<string, string | null>,
): Promise<string | null> {
  if (contents.has(path)) return contents.get(path) ?? null;
  const value = await currentFile(path);
  contents.set(path, value);
  return value;
}

export function resourceName(resource: string): string {
  return resource.split('/').at(-1) ?? resource;
}
