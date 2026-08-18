import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { confirm, isCancel } from '@clack/prompts';
import { defineCommand } from 'citty';
import {
  RESOURCE_ENTRY_FILES,
  resourceIdSchema,
  resourceKey,
  resourceVersionSchema,
} from '@ai-directory/contracts';
import {
  submitResource,
  validateResourceDirectory,
  type SubmitResourceOptions,
} from '@ai-directory/registry';
import { cancelled, getRegistrySource, isInteractiveTerminal, isResourceType, isSlug, reportError } from '../helpers';
import { promptRequiredText, promptResourceType, promptSlug, promptTemplateComponents } from '../prompts';
import { createResourceDirectory, parseTemplateComponents, type TemplateComponent } from '../scaffold';

export const create = defineCommand({
  meta: {
    name: 'create',
    description: 'Create a new resource directory',
  },
  args: {
    name: {
      type: 'positional',
      default: '',
      description: 'Resource name: lowercase words separated by hyphens',
    },
    type: {
      type: 'enum',
      options: ['skills', 'agents', 'rules', 'mcp-servers', 'templates', 'plugins'],
      alias: 't',
      description: 'Resource type',
    },
    owner: {
      type: 'string',
      default: '',
      description: 'Resource owner slug',
    },
    description: {
      type: 'string',
      default: '',
      description: 'Short description shown in the registry',
    },
    output: {
      type: 'string',
      alias: 'o',
      default: '',
      description: 'Output directory; defaults to ./<name>',
    },
    resources: {
      type: 'string',
      default: '',
      description: 'Template components: owner/type/name@version,...',
    },
    index: {
      type: 'string',
      alias: 'i',
      description: 'Local registry index for selecting template components',
    },
    repository: {
      type: 'string',
      description: 'Git repository for selecting template components',
    },
    base: {
      type: 'string',
      default: 'main',
      description: 'Production branch for template component selection',
    },
  },
  async run({ args }) {
    try {
      const interactive = isInteractiveTerminal();
      const typeValue = args.type ?? (interactive ? await promptResourceType() : undefined);
      if (!typeValue) {
        throw new Error('Resource type is required. Pass --type or run `aid create` in a terminal.');
      }

      if (!isResourceType(typeValue)) throw new Error(`Unsupported resource type: ${typeValue}`);

      const ownerValue = args.owner.trim() || (
        interactive ? await promptSlug('Who owns this resource?', 'jane-doe') : undefined
      );
      const nameValue = args.name.trim() || (
        interactive ? await promptSlug('What is the resource name?', 'my-resource') : undefined
      );
      const descriptionValue = args.description.trim() || (
        interactive
          ? await promptRequiredText('What does this resource do?', 'Short description')
          : undefined
      );

      if (!ownerValue || !isSlug(ownerValue)) {
        throw new Error('Owner is required and must use lowercase words separated by hyphens.');
      }
      if (!nameValue || !isSlug(nameValue)) {
        throw new Error('Resource name is required and must use lowercase words separated by hyphens.');
      }
      if (!descriptionValue) throw new Error('Description is required.');

      const outputValue = args.output.trim() || (
        interactive
          ? await promptRequiredText('Where should it be created?', `./${nameValue}`, `./${nameValue}`)
          : `./${nameValue}`
      );
      if (!outputValue) throw new Error('Output directory is required.');

      let components: TemplateComponent[] = [];
      if (typeValue === 'templates') {
        components = args.resources.trim()
          ? parseTemplateComponents(args.resources)
          : interactive
            ? await promptTemplateComponents(
                getRegistrySource(args.index, args.repository, args.base),
              ) ?? []
            : [];

        if (components.length === 0) {
          throw new Error(
            'Template components are required. Pass --resources or run `aid create` in a terminal.',
          );
        }
      }

      const outputDirectory = await createResourceDirectory({
        type: typeValue,
        owner: ownerValue,
        name: nameValue,
        description: descriptionValue,
        output: outputValue,
        components,
      });
      const id = `${ownerValue}/${typeValue}/${nameValue}`;

      console.log(`Created ${id} at ${outputDirectory}.`);
      console.log(`Entry file: ${join(outputDirectory, RESOURCE_ENTRY_FILES[typeValue])}`);
      console.log(
        `Next: aid submit "${outputValue}" --id ${id} --version 1.0.0 --description ${JSON.stringify(descriptionValue)}`,
      );
    } catch (error) {
      reportError(error);
    }
  },
});

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

      const resourceId = args.id.trim() || (
        interactive
          ? await promptRequiredText('What is the resource ID?', 'owner/skills/my-resource')
          : undefined
      );
      if (!resourceId) throw new Error('Resource ID is required. Pass `--id` in a script.');

      const result = await validateResourceDirectory({
        sourceDirectory,
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

      const resourceId = args.id.trim() || (
        interactive
          ? await promptRequiredText('What is the resource ID?', 'owner/skills/my-resource')
          : undefined
      );
      if (!resourceId) throw new Error('Resource ID is required. Pass `--id` in a script.');

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
        sourceDirectory: sourcePath,
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
