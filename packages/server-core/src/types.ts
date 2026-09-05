import type { DependencyCommandRunner } from '@ai-directory/installers';
import type { Hono } from 'hono';

export type ServerOptions = {
  cwd?: string;
  homeDirectory?: string;
  registryIndexPath?: string;
  environment?: NodeJS.ProcessEnv;
  dependencyCommandRunner?: DependencyCommandRunner;
  prewarm?: boolean;
  version?: string;
};

export type JsonValue = string | boolean | number | null | JsonValue[] | { [key: string]: JsonValue };
export type RequestBody = Record<string, JsonValue | undefined>;

export type RouteContext = {
  app: Hono;
  options: ServerOptions;
  cwd: string;
};
