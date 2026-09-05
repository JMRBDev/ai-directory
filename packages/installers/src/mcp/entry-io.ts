import type { Harness } from '../harnesses.js';
import { containerKey, readJsonEntry, removeJsonEntry, upsertJsonEntry } from './json-config.js';
import { readTomlEntry, removeTomlBlock, upsertTomlBlock } from './toml-config.js';
import type { JsonValue, McpChange, McpServerEntry, RemovalResult } from './types.js';
import { hashContent } from '../hashing.js';

export function upsertEntry(
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

export function readEntry(
  harness: Harness,
  content: string,
  path: string,
  server: string,
): JsonValue | undefined {
  return harness === 'codex'
    ? readTomlEntry(content, server)
    : readJsonEntry(content, containerKey(harness), server, path);
}

export function removeEntry(
  harness: Harness,
  content: string,
  path: string,
  server: string,
): RemovalResult {
  return harness === 'codex'
    ? removeTomlBlock(content, server)
    : removeJsonEntry(content, containerKey(harness), server, path);
}

export function change(
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

export function previewValue(value: JsonValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  const serialized = JSON.stringify(value, null, 2);
  return serialized === undefined ? undefined : serialized;
}

export function entryHash(entry: JsonValue | undefined): string {
  return hashContent(JSON.stringify(entry ?? null));
}
