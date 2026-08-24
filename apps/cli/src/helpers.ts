import { cancel, confirm, isCancel } from '@clack/prompts';
import { harnessSchema, resourceTypeSchema, type ResourceType } from '@ai-directory/contracts';
import { resolveRepository, type ConfigScope } from '@ai-directory/config';
import { resolveRegistrySource, type RegistrySourceOptions } from '@ai-directory/registry';
import type { Harness } from '@ai-directory/installers';

export const localIndexPath = process.env.AI_DIRECTORY_REGISTRY_INDEX;

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

export function getRegistrySource(
  indexPath?: string,
  repository?: string,
  baseBranch?: string,
) {
  const repositoryUrl = resolveRepository(repository);
  const sourceOptions: RegistrySourceOptions = {};
  const localPath = indexPath ?? (repository?.trim() ? undefined : localIndexPath);

  if (localPath) sourceOptions.indexPath = localPath;
  if (repositoryUrl) sourceOptions.repositoryUrl = repositoryUrl;
  if (baseBranch) sourceOptions.baseBranch = baseBranch;

  return resolveRegistrySource(sourceOptions);
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
        `Unsupported harness. Choose one or more of: claude-code, opencode, codex.`,
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
