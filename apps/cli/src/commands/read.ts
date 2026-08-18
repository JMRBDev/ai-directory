import { defineCommand } from 'citty';
import { resourceKey } from '@ai-directory/contracts';
import {
  readRegistrySourceIndex,
  readRegistrySourceResource,
  validateRegistrySource,
} from '@ai-directory/registry';
import { getRegistrySource, isInteractiveTerminal, reportError } from '../helpers';
import { promptResource } from '../prompts';

export const list = defineCommand({
  meta: {
    name: 'list',
    description: 'List resources in the registry index',
  },
  args: {
    index: {
      type: 'string',
      alias: 'i',
      description: 'Local registry index path; overrides the configured Git repository',
    },
    repository: {
      type: 'string',
      description: 'Git repository URL; uses a temporary sparse checkout',
    },
    type: {
      type: 'enum',
      options: ['skills', 'agents', 'rules', 'mcp-servers', 'templates'],
      alias: 't',
      description: 'Filter by resource type',
    },
    'include-retired': {
      type: 'boolean',
      description: 'Include retired resources',
    },
    json: {
      type: 'boolean',
      description: 'Print JSON instead of a table',
    },
  },
  async run({ args }) {
    try {
      const source = getRegistrySource(args.index, args.repository);
      const index = await readRegistrySourceIndex(source);
      const resources = index.resources
        .filter((resource) => !args.type || resource.type === args.type)
        .filter((resource) => args['include-retired'] || resource.lifecycleStatus === 'active')
        .sort((left, right) => resourceKey(left).localeCompare(resourceKey(right)));

      if (args.json) {
        console.log(JSON.stringify(resources, null, 2));
        return;
      }

      if (resources.length === 0) {
        console.log('No resources found.');
        return;
      }

      for (const resource of resources) {
        const status = resource.reviewStatus === 'reviewed' ? 'Reviewed' : 'Unreviewed';
        console.log(
          `${resourceKey(resource)}\t${resource.latestVersion}\t${status}\t${resource.description}`,
        );
      }
    } catch (error) {
      reportError(error);
    }
  },
});

export const show = defineCommand({
  meta: {
    name: 'show',
    description: 'Show a resource version and its files',
  },
  args: {
    resource: {
      type: 'positional',
      default: '',
      description: 'Resource ID: owner/type/name',
    },
    index: {
      type: 'string',
      alias: 'i',
      description: 'Local registry index path; overrides the configured Git repository',
    },
    version: {
      type: 'string',
      alias: 'v',
      description: 'Version to show; defaults to the latest version',
    },
    repository: {
      type: 'string',
      description: 'Git repository URL; uses a temporary sparse checkout',
    },
    base: {
      type: 'string',
      default: 'main',
      description: 'Production branch to read from',
    },
    json: {
      type: 'boolean',
      description: 'Print JSON instead of formatted Markdown',
    },
  },
  async run({ args }) {
    try {
      const source = getRegistrySource(args.index, args.repository, args.base);
      const resource = args.resource.trim() || (
        isInteractiveTerminal() ? await promptResource(source) : undefined
      );
      if (!resource) throw new Error('Resource ID is required. Run `aid show <resource>` in a script.');
      const result = (
        await readRegistrySourceResource(source, resource, args.version)
      ).resource;

      if (args.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      const review = result.resource.reviewStatus === 'reviewed' ? 'Reviewed' : 'Unreviewed';
      const lifecycle = result.resource.lifecycleStatus === 'active' ? 'Active' : 'Retired';

      console.log(`${resourceKey(result.resource)}@${result.version}`);
      console.log(`Description: ${result.resource.description}`);
      console.log(`Status: ${review}, ${lifecycle}`);

      if (result.resource.reviewStatus === 'unreviewed') {
        console.log('Warning: This resource has not been reviewed.');
      }

      for (const file of result.files) {
        console.log(`\n--- ${file.path} ---`);
        console.log(file.content.trimEnd());
      }
    } catch (error) {
      reportError(error);
    }
  },
});

export const check = defineCommand({
  meta: {
    name: 'check',
    description: 'Validate the selected registry source',
  },
  args: {
    index: {
      type: 'string',
      alias: 'i',
      description: 'Local registry index path; overrides the configured Git repository',
    },
    repository: {
      type: 'string',
      description: 'Registry Git URL; uses a temporary sparse checkout',
    },
    base: {
      type: 'string',
      default: 'main',
      description: 'Production branch to check remotely',
    },
  },
  async run({ args }) {
    try {
      const source = getRegistrySource(args.index, args.repository, args.base);
      const result = await validateRegistrySource(source);

      if (result.issues.length > 0) {
        console.error(`Registry check failed with ${result.issues.length} issue(s):`);
        for (const issue of result.issues) {
          console.error(`- ${issue}`);
        }
        process.exitCode = 1;
        return;
      }

      console.log(
        `Registry is valid. Checked ${result.resourceCount} resource(s) ${
          source.type === 'remote' ? 'from the configured remote repository' : `at ${source.indexPath}`
        }.`,
      );
    } catch (error) {
      reportError(error);
    }
  },
});
