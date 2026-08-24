import { z } from 'zod';
import type { ConfigScope } from '@ai-directory/config';
import type { ResourceVersion } from '@ai-directory/registry';
import type { Harness } from '../harnesses.js';
import type { InstallationRecord } from '../installation-records.js';

export type StringMap = Record<string, string>;
export type McpOauth = Record<string, string | number | string[]>;

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export type McpServerEntry = {
  type?: 'local' | 'remote' | 'http' | 'sse' | 'ws';
  command?: string | string[];
  args?: string[];
  cwd?: string;
  url?: string;
  headers?: StringMap;
  environment?: StringMap;
  env?: StringMap;
  oauth?: McpOauth;
  env_vars?: string[];
  bearer_token_env_var?: string;
  http_headers?: StringMap;
  env_http_headers?: StringMap;
  auth?: 'oauth';
  scopes?: string[];
};

export type McpEntryResult = {
  entry: McpServerEntry;
  notes: string[];
};

export type CodexHeaders = {
  staticHeaders: StringMap;
  envHeaders: StringMap;
  bearerTokenVar: string | undefined;
};

export type RemovalResult = {
  content: string;
  changed: boolean;
};

export type SectionBlock = {
  start: number;
  end: number;
};

export type McpOperation = {
  resource: string;
  harnesses: Harness[];
  action: 'install' | 'uninstall';
  version?: string;
  resources?: ResourceVersion[];
  resourceIds?: string[];
  scope?: ConfigScope;
  warningResources?: ResourceVersion[];
};

export type McpChange = {
  path: string;
  action: 'added' | 'modified' | 'removed';
  resource: string;
  harness: Harness;
  server: string;
  before?: string;
  after?: string;
};

export type McpPlan = {
  operations: McpOperation[];
  changes: McpChange[];
  conflicts: string[];
  warnings: string[];
  envNotes: string[];
  projectionNotes: string[];
  fingerprint: string;
};

export type McpApplyResult = {
  plan: McpPlan;
  installed: InstallationRecord[];
  removed: InstallationRecord[];
  warnings: string[];
};
