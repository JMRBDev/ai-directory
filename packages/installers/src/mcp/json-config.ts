import { applyEdits, parse, modify } from 'jsonc-parser';
import { z } from 'zod';
import type { Harness } from '../harnesses.js';
import { jsonValueSchema, type JsonValue, type McpServerEntry, type RemovalResult } from './types.js';

const jsonConfigSchema = z.object({
  mcpServers: z.record(z.string(), z.unknown()).optional(),
  mcp: z.record(z.string(), z.unknown()).optional(),
});
type JsonConfig = z.infer<typeof jsonConfigSchema>;

export function containerKey(harness: Harness): 'mcp' | 'mcpServers' {
  return harness === 'claude-code' ? 'mcpServers' : 'mcp';
}

export function readJsonConfig(content: string, path: string): JsonConfig {
  if (!content.trim()) return {};

  const errors: Array<{ error: number; offset: number; length: number }> = [];
  const data = parse(content, errors, { allowTrailingComma: true });

  if (errors.length > 0) {
    throw new Error(`MCP config is not valid JSON: ${path}`);
  }

  const result = jsonConfigSchema.safeParse(data);
  if (!result.success) {
    throw new Error(`MCP config is not a valid object: ${path}`);
  }
  return result.data;
}

export function upsertJsonEntry(
  content: string,
  containerKey: 'mcp' | 'mcpServers',
  name: string,
  entry: McpServerEntry,
  path: string,
): string {
  const base = content.trim() ? content : '{}';
  const config = readJsonConfig(base, path);
  const servers = { ...config[containerKey], [name]: entry };

  return applyEdits(
    base,
    modify(base, [containerKey], servers, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    }),
  );
}

export function removeJsonEntry(
  content: string,
  containerKey: 'mcp' | 'mcpServers',
  name: string,
  path: string,
): RemovalResult {
  const config = readJsonConfig(content, path);
  const servers = config[containerKey];
  if (servers === undefined || !(name in servers)) return { content, changed: false };

  const next = { ...servers };
  delete next[name];

  return {
    content: applyEdits(
      content,
      modify(content, [containerKey], next, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      }),
    ),
    changed: true,
  };
}

export function readJsonEntry(
  content: string,
  containerKey: 'mcp' | 'mcpServers',
  name: string,
  path: string,
): JsonValue | undefined {
  const config = readJsonConfig(content, path);
  const servers = config[containerKey];
  if (servers === undefined) return undefined;

  const result = jsonValueSchema.safeParse(servers[name]);
  return result.success ? result.data : undefined;
}
