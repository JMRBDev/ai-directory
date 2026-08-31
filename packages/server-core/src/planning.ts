import type { ConfigScope } from '@ai-directory/config';
import { resourceKey, type RegistryIndex } from '@ai-directory/contracts';
import {
  createCachedRegistry,
  type RegistrySnapshot,
} from '@ai-directory/registry';
import { type McpOperation, type ResourceChangeOptions, type ResourceOperation, type ResourcePackOperation } from '@ai-directory/installers';
import { registrySource } from './environment.js';
import type { ChangeOperationData } from './requests.js';
import type { ServerOptions } from './types.js';

export const cachedRegistry = createCachedRegistry();

export async function withRegistrySnapshot<T>(
  options: ServerOptions,
  cwd: string,
  action: (snapshot: RegistrySnapshot) => Promise<T>,
): Promise<T> {
  const snapshot = await cachedRegistry.get(registrySource(options, cwd));
  return action(snapshot);
}

export function changeOptions(
  options: ServerOptions,
  cwd: string,
  scope?: ConfigScope,
  dependencyOptions?: Pick<ResourceChangeOptions, 'installDependencies' | 'removeDependencies'>,
): ResourceChangeOptions {
  const result: ResourceChangeOptions = { cwd };
  if (options.homeDirectory) result.homeDirectory = options.homeDirectory;
  if (options.environment) result.environment = options.environment;
  if (scope) result.scope = scope;
  if (dependencyOptions?.installDependencies !== undefined) {
    result.installDependencies = dependencyOptions.installDependencies;
  }
  if (dependencyOptions?.removeDependencies !== undefined) {
    result.removeDependencies = dependencyOptions.removeDependencies;
  }
  if (options.dependencyCommandRunner) result.dependencyCommandRunner = options.dependencyCommandRunner;

  return result;
}

export type PlannedChangeSummary = {
  fingerprint: string;
  conflicts: string[];
};

export type ApplyOutcome<T> =
  | { stale: true; conflict: false; plan: PlannedChangeSummary }
  | { stale: false; conflict: true; plan: PlannedChangeSummary }
  | { stale: false; conflict: false; plan: PlannedChangeSummary; result: T };

export type RegistryApiResponse = {
  index: RegistryIndex | null;
  source: 'local' | 'remote' | 'none';
  repository?: string;
  error?: string;
};

export async function applyPlannedChange<T>(
  planFingerprint: string | undefined,
  force: boolean,
  plan: PlannedChangeSummary,
  apply: () => Promise<T>,
): Promise<ApplyOutcome<T>> {
  if (planFingerprint && planFingerprint !== plan.fingerprint) {
    return { stale: true, conflict: false, plan };
  }
  if (plan.conflicts.length > 0 && !force) {
    return { stale: false, conflict: true, plan };
  }
  return { stale: false, conflict: false, plan, result: await apply() };
}

export async function resolveOperations<T extends boolean>(
  operations: ChangeOperationData[],
  snapshot: RegistrySnapshot,
  isMcp: T,
): Promise<T extends true ? McpOperation[] : ResourceOperation[]> {
  const resolved = await Promise.all(operations.map(async (operation) => {
    const loaded = await snapshot.readResource(operation.resource, operation.version);

    if (isMcp) {
      const result: McpOperation = {
        resource: operation.resource,
        harnesses: operation.harnesses,
        action: operation.action,
        resources: loaded.resources,
        warningResources: [loaded.resource, ...loaded.resources],
      };
      if (operation.scope) result.scope = operation.scope;
      if (operation.version !== undefined) result.version = operation.version;
      if (operation.action === 'uninstall') {
        result.resourceIds = loaded.resources.map((item) => resourceKey(item.resource));
      }
      return result;
    }

    const result: ResourceOperation = {
      ...operation,
      resources: loaded.resources,
      warningResources: [loaded.resource, ...loaded.resources],
    };
    if (loaded.resource.resource.type === 'templates') {
      result.pack = {
        version: loaded.resource.version,
        resources: loaded.resources.map((resource) => ({
          resource: resourceKey(resource.resource),
          version: resource.version,
        })),
      } satisfies ResourcePackOperation;
    }
    return result;
  }));

  // SAFETY: The isMcp branch above yields McpOperation entries, the other
  // ResourceOperation entries, so the conditional type matches the data.
  return resolved as T extends true ? McpOperation[] : ResourceOperation[];
}
