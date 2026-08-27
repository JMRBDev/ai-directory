import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { confirm, isCancel } from '@clack/prompts';
import { defineCommand } from 'citty';
import {
  resourceIdSchema,
  resourceKey,
  resourceVersionSchema,
  type DetectedResource,
} from '@ai-directory/contracts';
import {
  detectResourceCandidates,
  submitResource,
  validateResourceDirectory,
  type SubmitResourceOptions,
} from '@ai-directory/registry';
import { cancelled, getRegistrySource, isInteractiveTerminal, isSlug, reportError, slugify } from '../helpers';
import { promptDetectedResource, promptRequiredText, promptSlug } from '../prompts';

type DetectionOutcome =
  | { status: 'none' }
  | { status: 'cancelled' }
  | { status: 'narrowed'; sourceDirectory: string; resourceId: string };

async function detectPublishTarget(sourcePath: string): Promise<DetectionOutcome> {
  const nested = (await detectResourceCandidates(sourcePath)).filter(
    (candidate) => candidate.root,
  );

  let chosen: DetectedResource;
  const [single] = nested;
  if (nested.length === 1 && single) {
    chosen = single;
    console.log(`Found one resource folder: ${chosen.root} (${chosen.type}).`);
  } else if (nested.length > 1) {
    const picked = await promptDetectedResource(nested);
    if (!picked) return { status: 'cancelled' };
    chosen = picked;
  } else {
    return { status: 'none' };
  }

  const ownerValue = await promptSlug('Who owns this resource?', 'jane-doe');
  if (!ownerValue) return { status: 'cancelled' };
  if (!isSlug(ownerValue)) {
    throw new Error('Owner is required and must use lowercase words separated by hyphens.');
  }

  const nameValue = slugify(chosen.name);
  if (!nameValue || !isSlug(nameValue)) {
    throw new Error(`Could not derive a resource name from ${chosen.root}. Pass --id explicitly.`);
  }

  return {
    status: 'narrowed',
    sourceDirectory: join(sourcePath, chosen.root),
    resourceId: `${ownerValue}/${chosen.type}/${nameValue}`,
  };
}

async function resolvePublishTarget(
  sourcePath: string,
  interactive: boolean,
  initialId: string,
  actionLabel: string,
): Promise<{ sourceDirectory: string; resourceId: string } | undefined> {
  let effectiveSource = sourcePath;
  let resourceId: string | undefined = initialId;

  if (!resourceId && interactive) {
    const outcome = await detectPublishTarget(sourcePath);
    if (outcome.status === 'cancelled') {
      cancelled(`${actionLabel} cancelled.`);
      return undefined;
    }
    if (outcome.status === 'narrowed') {
      effectiveSource = outcome.sourceDirectory;
      resourceId = outcome.resourceId;
      console.log(`${actionLabel} ${resourceId}.`);
    }
  }

  if (!resourceId) {
    resourceId = interactive
      ? await promptRequiredText('What is the resource ID?', 'owner/skills/my-resource')
      : undefined;
  }
  if (!resourceId) throw new Error('Resource ID is required. Pass `--id` in a script.');

  return { sourceDirectory: effectiveSource, resourceId };
}

export const validate = defineCommand({
  meta: {
    name: 'validate',
    description: 'Validate a local resource directory',
  },
  args: {
    source: {
      type: 'positional',
      default: '',
      description: 'Directory containing the resource entry file and supporting files',
    },
    id: {
      type: 'string',
      default: '',
      description: 'Resource ID: owner/type/name',
    },
    version: {
      type: 'string',
      alias: 'v',
      default: '1.0.0',
      description: 'Semantic version to validate',
    },
    json: {
      type: 'boolean',
      description: 'Print JSON instead of formatted output',
    },
  },
  async run({ args }) {
    try {
      const interactive = isInteractiveTerminal();
      const sourceDirectory = args.source.trim() || (
        interactive
          ? await promptRequiredText('Where is the resource directory?', './my-resource')
          : undefined
      );
      if (!sourceDirectory) {
        throw new Error('Resource directory is required. Run `aid validate <source>` in a script.');
      }

      const sourcePath = resolve(sourceDirectory);

      const target = await resolvePublishTarget(
        sourcePath,
        interactive,
        args.id.trim(),
        'Validating',
      );
      if (!target) return;
      const { sourceDirectory: effectiveSource, resourceId } = target;

      const result = await validateResourceDirectory({
        sourceDirectory: effectiveSource,
        resourceId,
        version: args.version.trim(),
      });

      if (args.json) {
        console.log(
          JSON.stringify(
            {
              resource: `${result.resource.owner}/${result.resource.type}/${result.resource.name}`,
              version: args.version,
              entryFile: result.entryFile.path,
              files: result.files.map((file) => file.path),
            },
            null,
            2,
          ),
        );
        return;
      }

      console.log(`Valid: ${resourceId}@${args.version}`);
      console.log(`Entry file: ${result.entryFile.path}`);
      console.log(`Files: ${result.files.length}`);
    } catch (error) {
      reportError(error);
    }
  },
});

export const submit = defineCommand({
  meta: {
    name: 'submit',
    description: 'Submit a prepared resource directory as a pull request',
  },
  args: {
    source: {
      type: 'positional',
      default: '',
      description: 'Directory containing the resource entry file and supporting files',
    },
    id: {
      type: 'string',
      default: '',
      description: 'Resource ID: owner/type/name',
    },
    version: {
      type: 'string',
      alias: 'v',
      default: '',
      description: 'New semantic version to publish',
    },
    description: {
      type: 'string',
      default: '',
      description: 'Short description shown in the registry',
    },
    index: {
      type: 'string',
      alias: 'i',
      description: 'Local registry index path; overrides the configured Git repository',
    },
    repository: {
      type: 'string',
      description: 'Git repository URL; uses a temporary partial checkout',
    },
    base: {
      type: 'string',
      default: 'main',
      description: 'Production branch to submit against',
    },
    branch: {
      type: 'string',
      description: 'Submission branch name; defaults to a generated name',
    },
    remote: {
      type: 'string',
      default: 'origin',
      description: 'Git remote to push the submission branch to',
    },
    title: {
      type: 'string',
      description: 'Pull request title',
    },
    body: {
      type: 'string',
      description: 'Pull request body',
    },
  },
  async run({ args }) {
    try {
      const interactive = isInteractiveTerminal();
      const sourceDirectory = args.source.trim() || (
        interactive
          ? await promptRequiredText('Where is the resource directory?', './resources/my-resource')
          : undefined
      );
      if (!sourceDirectory) throw new Error('Resource directory is required. Run `aid submit <source>` in a script.');

      let effectiveSource = resolve(sourceDirectory);

      const target = await resolvePublishTarget(
        effectiveSource,
        interactive,
        args.id.trim(),
        'Submitting',
      );
      if (!target) return;
      effectiveSource = target.sourceDirectory;
      const resourceId = target.resourceId;

      const version = args.version.trim() || (
        interactive
          ? await promptRequiredText('What version are you publishing?', '1.0.0', '1.0.0')
          : undefined
      );
      if (!version) throw new Error('Version is required. Pass `--version` in a script.');

      const description = args.description.trim();

      if (!resourceIdSchema.safeParse(resourceId).success) {
        throw new Error(`Invalid resource ID: ${resourceId}`);
      }
      if (!resourceVersionSchema.safeParse(version).success) {
        throw new Error(`Invalid resource version: ${version}`);
      }

      const sourcePath = resolve(sourceDirectory);
      if (!existsSync(sourcePath)) {
        throw new Error(`Resource directory not found: ${sourcePath}`);
      }

      if (interactive) {
        const answer = await confirm({
          message: `Submit ${resourceId}@${version} as a pull request?`,
          initialValue: true,
        });

        if (isCancel(answer) || !answer) return cancelled('Submission cancelled.');
      }

      const source = getRegistrySource(args.index, args.repository, args.base);
      const submitOptions: SubmitResourceOptions = {
        sourceDirectory: effectiveSource,
        resourceId,
        version,
        baseBranch: args.base,
        remote: args.remote,
      };
      if (source.type === 'local') submitOptions.indexPath = source.indexPath;
      if (description) submitOptions.description = description;
      if (source.type === 'remote') submitOptions.repositoryUrl = source.repositoryUrl;
      if (args.branch !== undefined) submitOptions.branch = args.branch;
      if (args.title !== undefined) submitOptions.title = args.title;
      if (args.body !== undefined) submitOptions.body = args.body;
      const result = await submitResource(submitOptions);

      console.log(
        `Submitted ${resourceKey(result.resource)}@${result.resource.latestVersion} as Unreviewed.`,
      );
      console.log(`Branch: ${result.branch}`);
      console.log(`Commit: ${result.commit}`);
      console.log(`Pull request: ${result.pullRequestUrl}`);
      console.log(`Files: ${result.files.join(', ')}`);
    } catch (error) {
      reportError(error);
    }
  },
});
