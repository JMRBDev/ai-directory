import { harnessSchema, HARNESS_ID_LIST } from '@ai-directory/contracts';
import type { ConfigScope } from '@ai-directory/config';
import type { Harness } from '@ai-directory/installers';
import { z } from 'zod';
import { isMcpResource } from './installations.js';
import type { RequestBody } from './types.js';

export const configScopeSchema = z.enum(['user', 'project']);

const harnessListSchema = z
  .union([
    z.array(harnessSchema),
    z.string(),
  ])
  .transform((value) => {
    const items = Array.isArray(value) ? value : value.split(',').map((item) => item.trim()).filter(Boolean);
    return [...new Set(items)];
  })
  .pipe(z.array(harnessSchema).min(1));

const resourceRequestObjectSchema = z.object({
  resource: z.string().trim().min(1),
  harnesses: harnessListSchema.optional(),
  version: z.string().trim().min(1).optional(),
  scope: configScopeSchema.optional(),
  force: z.boolean().default(false),
});

const resourceRequestWithDependenciesSchema = resourceRequestObjectSchema.extend({
  installDependencies: z.boolean().default(false),
  removeDependencies: z.boolean().default(false),
});

export type ResourceRequestData = {
  resource: string;
  harnesses: Harness[];
  version?: string;
  scope?: ConfigScope;
  force: boolean;
  installDependencies: boolean;
  removeDependencies: boolean;
};

function resourceRequestFrom(data: {
  resource: string;
  harnesses?: Harness[] | undefined;
  version?: string | undefined;
  scope?: ConfigScope | undefined;
  force: boolean;
  installDependencies?: boolean | undefined;
  removeDependencies?: boolean | undefined;
}): ResourceRequestData {
  const result: ResourceRequestData = {
    resource: data.resource,
    harnesses: data.harnesses ?? [],
    force: data.force,
    installDependencies: data.installDependencies ?? false,
    removeDependencies: data.removeDependencies ?? false,
  };
  if (data.version !== undefined) result.version = data.version;
  if (data.scope !== undefined) result.scope = data.scope;

  return result;
}

const harnessListMessage = `harnesses must include one or more of ${HARNESS_ID_LIST}.`;
const harnessOnlyMessage = `harnesses must include only ${HARNESS_ID_LIST}.`;

function requireHarnesses(data: { harnesses?: unknown }) {
  return data.harnesses !== undefined;
}

const projectScopeMessage = 'Project scope is only supported for MCP servers.';

function projectScopeOnlyForMcp(data: { resource: string; scope?: ConfigScope | undefined }) {
  return data.scope !== 'project' || isMcpResource(data.resource);
}

const resourceRequestSchema = resourceRequestWithDependenciesSchema
  .refine(projectScopeOnlyForMcp, { message: projectScopeMessage })
  .refine(requireHarnesses, { message: harnessListMessage })
  .transform(resourceRequestFrom);

export type ChangeOperationData = ResourceRequestData & { action: 'install' | 'uninstall' };

const changeOperationSchema = resourceRequestObjectSchema
  .extend({
    action: z.enum(['install', 'uninstall']),
  })
  .refine(projectScopeOnlyForMcp, { message: projectScopeMessage })
  .refine(requireHarnesses, { message: harnessListMessage })
  .transform((data) => ({ ...resourceRequestFrom(data), action: data.action }));

const changePlanRequestSchema = z.object({
  operations: z.array(changeOperationSchema).min(1),
  force: z.boolean().default(false),
  installDependencies: z.boolean().default(false),
  removeDependencies: z.boolean().default(false),
  planFingerprint: z.string().trim().min(1).optional(),
});

export type ChangePlanRequestData = z.infer<typeof changePlanRequestSchema>;

export const configRequestSchema = z.object({
  repository: z.string().trim().min(1),
  scope: configScopeSchema,
});

function requestErrorMessage(issues: z.ZodIssue[]): string {
  for (const issue of issues) {
    if (issue.code === 'custom') return issue.message;
    const field = issue.path[issue.path.length - 1];
    if (field === 'resource') return 'resource must be a non-empty string.';
    if (field === 'harnesses') {
      return issue.code === 'too_small'
        ? harnessListMessage
        : harnessOnlyMessage;
    }
    if (field === 'version') {
      return issue.code === 'invalid_type'
        ? 'version must be a string.'
        : 'version must be a non-empty string.';
    }
    if (field === 'force' || field === 'installDependencies' || field === 'removeDependencies') {
      return field + ' must be a boolean.';
    }
  }

  return 'Request body must be a JSON object.';
}

function changePlanErrorMessage(issues: z.ZodIssue[]): string {
  for (const issue of issues) {
    if (issue.code === 'custom') return issue.message;
    if (issue.path.length === 0) return 'Request body must be a JSON object.';
    const field = issue.path[issue.path.length - 1];
    if (issue.path[0] === 'operations' && issue.path.length === 1) {
      return 'operations must include one or more resource changes.';
    }
    if (issue.path[0] === 'operations' && issue.path.length === 2) {
      return 'Each operation must be a JSON object.';
    }
    if (issue.path[0] === 'operations' && field === 'action') {
      return 'Each operation action must be install or uninstall.';
    }
    if (issue.path[0] === 'operations') {
      return requestErrorMessage([issue]);
    }
    if (field === 'force' || field === 'installDependencies' || field === 'removeDependencies') {
      return field + ' must be a boolean.';
    }
    if (field === 'planFingerprint') return 'planFingerprint must be a non-empty string.';
  }

  return 'Request body must be a JSON object.';
}

export function requestError(body: RequestBody): string | null {
  const result = resourceRequestSchema.safeParse(body);
  return result.success ? null : requestErrorMessage(result.error.issues);
}

export function parseResourceRequest(body: RequestBody): ResourceRequestData {
  return resourceRequestSchema.parse(body);
}

function duplicateOperationError(operations: ChangeOperationData[]): string | null {
  const keys = new Set<string>();
  for (const operation of operations) {
    for (const harness of operation.harnesses) {
      const key = `${harness}:${operation.resource}`;
      if (keys.has(key)) return `The operation is listed more than once: ${key}.`;
      keys.add(key);
    }
  }

  return null;
}

export function changePlanError(body: RequestBody): string | null {
  const result = changePlanRequestSchema.safeParse(body);
  if (!result.success) return changePlanErrorMessage(result.error.issues);

  return duplicateOperationError(result.data.operations);
}

export function parseChangeOperations(body: RequestBody): ChangePlanRequestData {
  return changePlanRequestSchema.parse(body);
}
