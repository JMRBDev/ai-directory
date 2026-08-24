import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { resourceIdSchema, resourceKey, type ResourceSummary } from '@ai-directory/contracts';
import { clonePartialRepository, executeCommand, runCommand } from './git.js';
import { resolveDirectory } from './paths.js';
import { publishResource } from './publish.js';
import type {
  SubmitResourceOptions,
  SubmitResourceResult,
} from './types.js';

export async function submitResource(
  options: SubmitResourceOptions,
): Promise<SubmitResourceResult> {
  if (options.repositoryUrl) {
    const temporaryRepository = await mkdtemp(join(tmpdir(), 'ai-directory-submit-'));
    const runner = options.commandRunner ?? runCommand;

    try {
      await clonePartialRepository(
        runner,
        options.repositoryUrl,
        temporaryRepository,
        options.baseBranch ?? 'main',
      );

      return await submitResourceInCheckout({
        ...options,
        indexPath: join(temporaryRepository, 'index.json'),
      });
    } finally {
      await rm(temporaryRepository, { recursive: true, force: true });
    }
  }

  const indexPath = options.indexPath;

  if (!indexPath) {
    throw new Error('Local submission requires an index path. Pass `--index <path>`.');
  }

  return submitResourceInCheckout({ ...options, indexPath });
}

async function submitResourceInCheckout(
  options: SubmitResourceOptions & { indexPath: string },
): Promise<SubmitResourceResult> {
  if (!resourceIdSchema.safeParse(options.resourceId).success) {
    throw new Error(`Invalid resource ID: ${options.resourceId}`);
  }

  const registryIndexPath = await resolveDirectory(options.indexPath, 'Registry index');
  const registryRoot = dirname(registryIndexPath);
  const runner = options.commandRunner ?? runCommand;
  const baseBranch = options.baseBranch ?? 'main';
  const remote = options.remote ?? 'origin';
  const branch =
    options.branch ?? `submit/${options.resourceId.replaceAll('/', '-')}-${options.version}`;

  const status = await executeCommand(
    runner,
    'git',
    ['status', '--porcelain', '--untracked-files=all'],
    registryRoot,
  );

  if (status.stdout.trim()) {
    throw new Error('Registry working tree is not clean. Commit or stash existing changes first.');
  }

  const currentBranch = await executeCommand(
    runner,
    'git',
    ['branch', '--show-current'],
    registryRoot,
  );

  if (currentBranch.stdout.trim() !== baseBranch) {
    throw new Error(
      `Registry must be checked out on ${baseBranch}; found ${currentBranch.stdout.trim() || 'detached HEAD'}.`,
    );
  }

  await executeCommand(runner, 'git', ['remote', 'get-url', remote], registryRoot);
  await executeCommand(runner, 'gh', ['auth', 'status'], registryRoot);
  await executeCommand(runner, 'git', ['switch', '-c', branch], registryRoot);

  try {
    const published = await publishResource(options);
    const indexFile = relative(registryRoot, registryIndexPath);
    const packageDirectory = relative(registryRoot, published.packageDirectory);

    await executeCommand(
      runner,
      'git',
      ['add', '--sparse', '--', indexFile, packageDirectory],
      registryRoot,
    );
    await executeCommand(
      runner,
      'git',
      [
        'commit',
        '-m',
        `Submit ${resourceKey(published.resource)}@${published.resource.latestVersion}`,
      ],
      registryRoot,
    );

    const commit = await executeCommand(runner, 'git', ['rev-parse', 'HEAD'], registryRoot);
    await executeCommand(runner, 'git', ['push', '--set-upstream', remote, branch], registryRoot);

    const pullRequest = await executeCommand(
      runner,
      'gh',
      [
        'pr',
        'create',
        '--base',
        baseBranch,
        '--head',
        branch,
        '--title',
        options.title ?? `Submit ${resourceKey(published.resource)}@${published.resource.latestVersion}`,
        '--body',
        options.body ?? defaultPullRequestBody(published.resource),
      ],
      registryRoot,
    );
    const pullRequestUrl = pullRequest.stdout.trim();

    if (!pullRequestUrl) {
      throw new Error('GitHub CLI did not return a pull request URL.');
    }

    return {
      resource: published.resource,
      branch,
      commit: commit.stdout.trim(),
      pullRequestUrl,
      files: published.files,
    };
  } catch (error) {
    throw new Error(
      `Submission branch ${branch} was created, but the pull request was not completed: ${error instanceof Error ? error.message : error}`,
      { cause: error },
    );
  }
}

function defaultPullRequestBody(resource: ResourceSummary): string {
  return [
    `Resource: ${resourceKey(resource)}`,
    `Version: ${resource.latestVersion}`,
    '',
    resource.description,
    '',
    'This submission is unreviewed until the pull request is reviewed and merged.',
  ].join('\n');
}
