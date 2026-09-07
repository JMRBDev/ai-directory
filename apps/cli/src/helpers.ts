import { cancel, confirm, isCancel } from '@clack/prompts';
import { harnessSchema, HARNESS_ID_LIST, resourceTypeSchema, type ResourceType } from '@ai-directory/contracts';
import {
  normalizeRegistryId,
  readRegistryEntries,
  resolveRepository,
  type ConfigScope,
} from '@ai-directory/config';
import {
  aggregateRegistrySources,
  resolveRegistrySource,
  type AggregatedRegistryIdentity,
  type AggregatedRegistryResult,
  type RegistrySource,
  type RegistrySourceOptions,
} from '@ai-directory/registry';
import type { Harness } from '@ai-directory/installers';

export const localIndexPath = process.env.AI_DIRECTORY_REGISTRY_INDEX;

export type RegistryEndpoint = {
  id: string;
  source: RegistrySource;
  identity: AggregatedRegistryIdentity;
};

export function reportError(cause: unknown): void {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
}

export function cancelled(message: string): undefined {
  cancel(message);
  return undefined;
}

export function isInteractiveTerminal(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

export function registryEndpoints(): RegistryEndpoint[] {
  const configuredIndex = localIndexPath?.trim();
  if (configuredIndex) {
    return [{
      id: 'local-index',
      source: resolveRegistrySource({ indexPath: configuredIndex }),
      identity: { id: 'local-index' },
    }];
  }
  return readRegistryEntries()
    .filter((entry) => entry.enabled !== false)
    .map((entry) => ({
      id: entry.id,
      source: resolveRegistrySource({ repositoryUrl: entry.url, baseBranch: entry.branch ?? 'main' }),
      identity: { id: entry.id, url: entry.url, branch: entry.branch ?? 'main' },
    }));
}

export function getRegistryEndpoint(id?: string): RegistryEndpoint {
  const endpoints = registryEndpoints();
  if (endpoints.length === 0) {
    throw new Error('No registry source configured. Run `aid setup` or pass `--index <path>`.');
  }
  if (!id?.trim()) {
    const first = endpoints[0];
    if (!first) throw new Error('No registry source configured.');
    return first;
  }
  const normalized = normalizeRegistryId(id);
  const match = endpoints.find((entry) => entry.id === normalized);
  if (!match) throw new Error(`Unknown registry: ${id}.`);
  return match;
}

export function getRegistrySource(
  indexPath?: string,
  repository?: string,
  baseBranch?: string,
  registryId?: string,
) {
  if (registryId?.trim()) return getRegistryEndpoint(registryId).source;
  if (repository?.trim()) {
    return resolveRegistrySource({
      repositoryUrl: repository.trim(),
      baseBranch: baseBranch?.trim() || 'main',
    });
  }
  const repositoryUrl = resolveRepository(undefined);
  const sourceOptions: RegistrySourceOptions = {};
  const localPath = indexPath ?? (!repositoryUrl ? localIndexPath : undefined);

  if (localPath) sourceOptions.indexPath = localPath;
  if (repositoryUrl) sourceOptions.repositoryUrl = repositoryUrl;
  if (baseBranch) sourceOptions.baseBranch = baseBranch;

  return resolveRegistrySource(sourceOptions);
}

export async function aggregatedRegistries(): Promise<AggregatedRegistryResult> {
  const endpoints = registryEndpoints();
  if (endpoints.length === 0) {
    return { entries: [], registries: [], errors: [] };
  }
  return aggregateRegistrySources(
    endpoints.map((endpoint) => ({ source: endpoint.source, registry: endpoint.identity })),
  );
}

export function splitRegistrySuffix(resource: string): { id: string; registry?: string } {
  const at = resource.lastIndexOf('@');
  if (at <= 0) return { id: resource };
  const id = resource.slice(0, at).trim();
  const registry = resource.slice(at + 1).trim().toLowerCase();
  if (!id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(registry)) return { id: resource };
  return { id, registry };
}

export function parseHarnesses(value: string | undefined, rawArgs: string[]): Harness[] {
  const explicit: string[] = [];

  for (let index = 0; index < rawArgs.length; index += 1) {
    const argument = rawArgs[index];

    if (argument === '--harness') {
      const next = rawArgs[index + 1];
      if (next) explicit.push(next);
      index += 1;
    } else if (argument?.startsWith('--harness=')) {
      explicit.push(argument.slice('--harness='.length));
    }
  }

  const values = (explicit.length > 0 ? explicit : [value ?? ''])
    .flatMap((item) => item.split(','))
    .map((item) => item.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const harnesses: Harness[] = [];

  for (const candidate of values) {
    if (!isHarness(candidate)) {
      throw new Error(
        `Unsupported harness. Choose one or more of: ${HARNESS_ID_LIST}.`,
      );
    }
    if (!seen.has(candidate)) {
      seen.add(candidate);
      harnesses.push(candidate);
    }
  }

  if (harnesses.length === 0) {
    throw new Error('Select one or more harnesses with --harness.');
  }

  return harnesses;
}

export function hasHarnessArgument(rawArgs: string[]): boolean {
  return rawArgs.some(
    (argument) => argument === '--harness' || argument.startsWith('--harness='),
  );
}

export function isHarness(value: string): value is Harness {
  return harnessSchema.safeParse(value).success;
}

export function isResourceType(value: string): value is ResourceType {
  return resourceTypeSchema.safeParse(value).success;
}

export function isSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function resourceTitle(name: string): string {
  return name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function parseScope(value: string | undefined): ConfigScope {
  const scope = value ?? 'user';
  if (scope !== 'user' && scope !== 'project') {
    throw new Error('Scope must be one of: user, project.');
  }
  return scope;
}

export function isForceableError(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return /Use --force|modified|ownership hashes|Change plan contains conflicts/u.test(message);
}

export async function withInteractiveForce<T>(
  interactive: boolean,
  force: boolean,
  action: (force: boolean) => Promise<T>,
): Promise<T | undefined> {
  try {
    return await action(force);
  } catch (error) {
    if (!interactive || force || !isForceableError(error)) throw error;

    const answer = await confirm({
      message: 'Some managed files already exist or changed locally. Continue with force?',
      initialValue: false,
    });

    if (isCancel(answer) || !answer) return cancelled('Operation cancelled.');
    return action(true);
  }
}
