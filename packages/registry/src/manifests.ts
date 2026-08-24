import {
  PLUGIN_ENTRY_FILES,
  mcpServerManifestSchema,
  pluginManifestSchema,
  resourceKey,
  templateManifestSchema,
  toolManifestSchema,
  type McpServerManifest,
  type TemplateManifest,
  type ToolManifest,
} from '@ai-directory/contracts';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { PluginManifestResult, ResourceVersion } from './types.js';

export function readTemplateManifest(resource: ResourceVersion): TemplateManifest {
  return readYamlManifest(resource, {
    entryPath: 'TEMPLATE.md',
    expectedType: 'templates',
    notALabel: 'a template',
    messageKind: 'Template',
    schema: templateManifestSchema,
  });
}

export function readMcpServerManifest(resource: ResourceVersion): McpServerManifest {
  return readYamlManifest(resource, {
    entryPath: 'MCP.md',
    expectedType: 'mcp-servers',
    notALabel: 'an MCP server',
    messageKind: 'MCP',
    schema: mcpServerManifestSchema,
  });
}

export function readToolManifest(resource: ResourceVersion): ToolManifest {
  const manifest = readYamlManifest(resource, {
    entryPath: 'TOOL.md',
    expectedType: 'tools',
    notALabel: 'a tool',
    messageKind: 'Tool',
    schema: toolManifestSchema,
  });

  const missingExecutables = manifest.executables.filter(
    (path) => !resource.files.some((file) => file.path === path),
  );

  if (missingExecutables.length > 0) {
    throw new Error(
      `Tool manifest lists missing executable file(s): ${missingExecutables.join(', ')}`,
    );
  }

  return manifest;
}

function readYamlManifest<M extends { name: string }>(
  resource: ResourceVersion,
  options: {
    entryPath: string;
    expectedType: string;
    notALabel: string;
    messageKind: string;
    schema: z.ZodType<M>;
  },
): M {
  const { entryPath, expectedType, notALabel, messageKind, schema } = options;

  if (resource.resource.type !== expectedType) {
    throw new Error(`Resource is not ${notALabel}: ${resourceKey(resource.resource)}`);
  }

  const entryFile = resource.files.find((file) => file.path === entryPath);

  if (!entryFile) {
    throw new Error(`${messageKind} is missing ${entryPath}: ${resourceKey(resource.resource)}`);
  }

  const frontmatter = entryFile.content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);

  if (!frontmatter) {
    throw new Error(
      `${messageKind} manifest is missing YAML frontmatter: ${resourceKey(resource.resource)}@${resource.version}`,
    );
  }

  let data: unknown;

  try {
    data = parseYaml(frontmatter[1] ?? '');
  } catch (error) {
    throw new Error(
      `${messageKind} manifest is not valid YAML: ${resourceKey(resource.resource)}@${resource.version}`,
      { cause: error },
    );
  }

  const result = schema.safeParse(data);

  if (!result.success) {
    throw manifestInvalidError(messageKind, resource, result.error.issues);
  }

  if (result.data.name !== resource.resource.name) {
    throw new Error(
      `${messageKind} manifest name does not match resource name: ${result.data.name} !== ${resource.resource.name}`,
    );
  }

  return result.data;
}

function manifestInvalidError(
  messageKind: string,
  resource: ResourceVersion,
  issues: z.ZodIssue[],
): Error {
  const formatted = issues
    .map((issue) => `${issue.path.join('.') || 'manifest'}: ${issue.message}`)
    .join('; ');

  return new Error(
    `${messageKind} manifest is invalid (${resourceKey(resource.resource)}@${resource.version}): ${formatted}`,
  );
}

export function readPluginManifest(resource: ResourceVersion): PluginManifestResult {
  if (resource.resource.type !== 'plugins') {
    throw new Error(`Resource is not a plugin: ${resourceKey(resource.resource)}`);
  }

  const entryFile = resource.files.find((file) =>
    PLUGIN_ENTRY_FILES.some((entry) => entry === file.path),
  );

  if (!entryFile) {
    throw new Error(
      `Plugin is missing a manifest (${PLUGIN_ENTRY_FILES.join(' or ')}): ${resourceKey(resource.resource)}`,
    );
  }

  let data: unknown;

  try {
    data = JSON.parse(entryFile.content);
  } catch (error) {
    throw new Error(
      `Plugin manifest is not valid JSON: ${resourceKey(resource.resource)}@${resource.version}`,
      { cause: error },
    );
  }

  const result = pluginManifestSchema.safeParse(data);

  if (!result.success) {
    throw manifestInvalidError('Plugin', resource, result.error.issues);
  }

  if (result.data.name !== resource.resource.name) {
    throw new Error(
      `Plugin manifest name does not match resource name: ${result.data.name} !== ${resource.resource.name}`,
    );
  }

  return { file: entryFile, manifest: result.data };
}
