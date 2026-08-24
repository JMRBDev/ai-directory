import type { DependencyCommandRunner } from '@ai-directory/installers';
import type { CommandRunner } from '@ai-directory/registry';
import type { Hono } from 'hono';

export type ServerOptions = {
  cwd?: string;
  homeDirectory?: string;
  registryIndexPath?: string;
  environment?: NodeJS.ProcessEnv;
  commandRunner?: CommandRunner;
  dependencyCommandRunner?: DependencyCommandRunner;
  prewarm?: boolean;
};

export type JsonValue = string | boolean | number | null | JsonValue[] | { [key: string]: JsonValue };
export type RequestBody = Record<string, JsonValue | undefined>;
export type MultipartValue = string | File | Array<string | File>;
export type MultipartBody = Record<string, MultipartValue>;

export type RouteContext = {
  app: Hono;
  options: ServerOptions;
  cwd: string;
};
