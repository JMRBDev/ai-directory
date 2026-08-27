import { z } from 'zod';

export const resourceTypeSchema = z.enum([
  'skills',
  'agents',
  'rules',
  'mcp-servers',
  'templates',
  'plugins',
  'tools',
]);
export const resourceReviewStatusSchema = z.enum(['unreviewed', 'reviewed']);
export const resourceLifecycleStatusSchema = z.enum(['active', 'retired']);
export const resourceVisibilitySchema = z.enum(['private', 'targeted', 'public']);

const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const resourceVersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);

export const resourceIdSchema = z.string().regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*\/(?:skills|agents|rules|mcp-servers|templates|plugins|tools)\/[a-z0-9]+(?:-[a-z0-9]+)*$/,
);

const templateResourceIdSchema = resourceIdSchema.refine(
  (id) => !id.includes('/templates/'),
  'Templates cannot contain nested templates',
);

export const templateManifestSchema = z.object({
  name: slugSchema,
  description: z.string().min(1),
  resources: z
    .array(
      z.object({
        id: templateResourceIdSchema,
        version: resourceVersionSchema,
      }),
    )
    .min(1),
});

export const pluginManifestSchema = z
  .object({
    name: slugSchema,
    description: z.string().min(1).optional(),
    version: resourceVersionSchema.optional(),
  })
  .passthrough();

export type PluginManifest = z.infer<typeof pluginManifestSchema>;

const toolPathSchema = z.string().min(1).refine((value) => {
  const normalized = value.replaceAll('\\', '/');
  const segments = normalized.split('/');
  return !normalized.startsWith('/') && !segments.includes('') && !segments.includes('..');
}, 'Must be a relative resource file path.');

const toolCommandSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const toolPackageSchema = z.string().regex(/^[A-Za-z0-9@._/+:-]+$/);

export const toolPackageManagerSchema = z.enum(['homebrew', 'pipx', 'npm', 'cargo']);

export const toolInstallerSchema = z.object({
  manager: toolPackageManagerSchema,
  package: toolPackageSchema,
});

export const toolDependencySchema = z.object({
  command: toolCommandSchema,
  minimumVersion: resourceVersionSchema.optional(),
  installers: z.array(toolInstallerSchema).min(1),
});

export const toolRuntimeSchema = toolDependencySchema.extend({
  dependencies: z.array(toolDependencySchema).default([]),
});

export const toolManifestSchema = z
  .object({
  name: slugSchema,
  description: z.string().min(1),
  command: toolCommandSchema,
  executables: z.array(toolPathSchema).default([]),
  runtime: toolRuntimeSchema.optional(),
  })
  .refine(
    (manifest) => manifest.runtime === undefined || manifest.runtime.command === manifest.command,
    'Tool runtime command must match the tool command.',
  );

export type ToolManifest = z.infer<typeof toolManifestSchema>;
export type ToolDependency = z.infer<typeof toolDependencySchema>;
export type ToolInstaller = z.infer<typeof toolInstallerSchema>;
export type ToolPackageManager = z.infer<typeof toolPackageManagerSchema>;
export type ToolRuntime = z.infer<typeof toolRuntimeSchema>;

export const mcpTransportSchema = z.enum(['stdio', 'http', 'sse', 'ws']);

export const mcpEnvVarSchema = z.object({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  required: z.boolean().optional(),
  description: z.string().min(1).optional(),
});

export const mcpEnvTokenPattern = /\{env:([A-Za-z_][A-Za-z0-9_]*)\}/gu;

export function mcpEnvTokens(value: string): string[] {
  return [...value.matchAll(mcpEnvTokenPattern)]
    .map((match) => match[1])
    .filter((token): token is string => token !== undefined);
}

export const mcpServerManifestSchema = z
  .object({
    name: slugSchema,
    description: z.string().min(1),
    transport: mcpTransportSchema,
    command: z.string().min(1).optional(),
    args: z.array(z.string().min(1)).optional(),
    cwd: z.string().min(1).optional(),
    url: z.string().min(1).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    env: z.array(mcpEnvVarSchema).optional(),
    oauth: z
      .object({
        enabled: z.boolean().optional(),
        scopes: z.array(z.string().min(1)).optional(),
        clientId: z.string().min(1).optional(),
        clientSecretVar: z.string().min(1).optional(),
        callbackPort: z.number().int().positive().optional(),
      })
      .optional(),
  })
  .refine(
    (manifest) => {
      const remote = manifest.transport !== 'stdio';
      return remote
        ? manifest.url !== undefined
        : manifest.command !== undefined;
    },
    'MCP stdio servers need a command; http, sse, and ws servers need a url.',
  )
  .refine(
    (manifest) => {
      if (manifest.transport === 'stdio') return true;
      const tokens = new Set(
        Object.values(manifest.headers ?? {}).flatMap((value) => mcpEnvTokens(value)),
      );
      return (manifest.env ?? []).every((variable) => tokens.has(variable.name));
    },
    'Remote MCP servers must reference every declared env variable in a header value with {env:NAME}.',
  );

export type McpTransport = z.infer<typeof mcpTransportSchema>;
export type McpServerManifest = z.infer<typeof mcpServerManifestSchema>;

export const resourceSummarySchema = z.object({
  owner: slugSchema,
  type: resourceTypeSchema,
  name: slugSchema,
  description: z.string().min(1),
  latestVersion: resourceVersionSchema,
  reviewStatus: resourceReviewStatusSchema,
  lifecycleStatus: resourceLifecycleStatusSchema,
  visibility: resourceVisibilitySchema,
  updatedAt: z.string().min(1),
});

export const registryIndexSchema = z.object({
  schemaVersion: z.literal(1),
  resources: z.array(resourceSummarySchema),
});

export type ResourceType = z.infer<typeof resourceTypeSchema>;
export type ResourceSummary = z.infer<typeof resourceSummarySchema>;
export type RegistryIndex = z.infer<typeof registryIndexSchema>;
export type TemplateManifest = z.infer<typeof templateManifestSchema>;

export type Harness = 'claude-code' | 'opencode' | 'codex';
export const harnessSchema = z.enum(['claude-code', 'opencode', 'codex']);
export const HARNESS_IDS: readonly Harness[] = harnessSchema.options;
export const HARNESS_ID_LIST = HARNESS_IDS.join(', ');

export const RESOURCE_ENTRY_FILES = {
  skills: 'SKILL.md',
  agents: 'AGENT.md',
  rules: 'RULE.md',
  'mcp-servers': 'MCP.md',
  templates: 'TEMPLATE.md',
  plugins: '.claude-plugin/plugin.json',
  tools: 'TOOL.md',
} satisfies Record<ResourceType, string>;

export const PLUGIN_ENTRY_FILES = [
  '.claude-plugin/plugin.json',
  '.codex-plugin/plugin.json',
] as const;

export function resourceEntryFiles(type: ResourceType): readonly string[] {
  return type === 'plugins' ? PLUGIN_ENTRY_FILES : [RESOURCE_ENTRY_FILES[type]];
}

export function resourceKey(resource: Pick<ResourceSummary, 'owner' | 'type' | 'name'>): string {
  return `${resource.owner}/${resource.type}/${resource.name}`;
}

export type DetectedResource = {
  type: ResourceType;
  entryFile: string;
  root: string;
  name: string;
};

export function detectResourceRoots(
  paths: readonly string[],
  fallbackName?: string,
): DetectedResource[] {
  const detected = new Map<string, DetectedResource>();

  for (const path of paths) {
    const normalized = path.replaceAll('\\', '/');

    for (const type of resourceTypeSchema.options) {
      for (const entryFile of resourceEntryFiles(type)) {
        if (normalized !== entryFile && !normalized.endsWith(`/${entryFile}`)) continue;

        const root = normalized.slice(0, normalized.length - entryFile.length).replace(/\/$/, '');
        const key = `${type}\u0000${root}`;
        if (detected.has(key)) continue;

        const segments = root ? root.split('/') : [];
        detected.set(key, {
          type,
          entryFile,
          root,
          name: segments.at(-1) ?? fallbackName ?? '',
        });
      }
    }
  }

  return [...detected.values()].sort((left, right) =>
    left.root === right.root
      ? left.type.localeCompare(right.type)
      : left.root.localeCompare(right.root),
  );
}
