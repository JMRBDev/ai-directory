import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { z } from 'zod';
import { jsonValueSchema, type JsonValue, type McpServerEntry, type RemovalResult, type SectionBlock } from './types.js';

const tomlConfigSchema = z.object({
  mcp_servers: z.record(z.string(), z.unknown()).optional(),
});
type TomlConfig = z.infer<typeof tomlConfigSchema>;

export function readTomlConfig(content: string, path: string): TomlConfig {
  if (!content.trim()) return {};

  try {
    const doc = parseToml(content);
    const result = tomlConfigSchema.safeParse(doc);
    if (!result.success) {
      throw new Error(`MCP config is not a valid object: ${path}`);
    }
    return result.data;
  } catch (error) {
    throw new Error(`MCP config is not valid TOML: ${path}`, { cause: error });
  }
}

function tomlHeader(server: string): string {
  return `[mcp_servers.${server}]`;
}

function tomlServerBlock(content: string, server: string): SectionBlock | undefined {
  const header = tomlHeader(server);
  const lines = content.split('\n');
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) return undefined;

  const subtablePrefix = `[mcp_servers.${server}.`;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const trimmed = (lines[index] ?? '').trim();
    if (!trimmed.startsWith('[')) continue;
    if (trimmed.startsWith(subtablePrefix)) continue;
    end = index;
    break;
  }

  return { start, end };
}

export function readTomlEntry(content: string, server: string): JsonValue | undefined {
  const block = tomlServerBlock(content, server);
  if (!block) return undefined;

  const lines = content.split('\n');
  const section = lines.slice(block.start, block.end).join('\n');
  if (!section.trim()) return undefined;

  try {
    const config = readTomlConfig(section, 'mcp server entry');
    const result = jsonValueSchema.safeParse(config.mcp_servers?.[server]);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

export function upsertTomlBlock(content: string, server: string, entry: McpServerEntry): string {
  const block = stringifyToml({ mcp_servers: { [server]: entry } }).trimEnd();
  const found = tomlServerBlock(content, server);

  if (found) {
    const lines = content.split('\n');
    lines.splice(found.start, found.end - found.start, ...block.split('\n'));
    return lines.join('\n');
  }

  if (!content.trim()) return `${block}\n`;

  const separator = content.endsWith('\n') ? '' : '\n';
  return `${content}${separator}\n\n${block}\n`;
}

export function removeTomlBlock(content: string, server: string): RemovalResult {
  const found = tomlServerBlock(content, server);
  if (!found) return { content, changed: false };

  const lines = content.split('\n');
  lines.splice(found.start, found.end - found.start);

  return {
    content: lines.join('\n').replace(/\n{3,}/u, '\n\n'),
    changed: true,
  };
}
