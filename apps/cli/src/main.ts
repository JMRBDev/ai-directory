#!/usr/bin/env bun

import { defineCommand, runMain } from 'citty';
import { resourceKey } from '@ai-directory/domain';
import {
  fetchRegistryIndex,
  readRegistryIndex,
  readResourceVersion,
} from '@ai-directory/registry';

const defaultIndexPath = process.env.AI_DIRECTORY_REGISTRY_INDEX ?? '.ai-directory/registry/index.json';
const defaultIndexUrl = process.env.AI_DIRECTORY_REGISTRY_INDEX_URL;

const list = defineCommand({
  meta: {
    name: 'list',
    description: 'List resources in the registry index',
  },
  args: {
    index: {
      type: 'string',
      alias: 'i',
      default: defaultIndexPath,
      description: 'Path to a registry index JSON file',
    },
    remote: {
      type: 'string',
      alias: 'r',
      default: defaultIndexUrl,
      description: 'URL of a registry index JSON file',
    },
    type: {
      type: 'enum',
      options: ['skills', 'agents', 'rules', 'templates'],
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
      const index = args.remote
        ? await fetchRegistryIndex(args.remote)
        : await readRegistryIndex(args.index);
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
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  },
});

const show = defineCommand({
  meta: {
    name: 'show',
    description: 'Show a resource version and its files',
  },
  args: {
    resource: {
      type: 'positional',
      required: true,
      description: 'Resource ID: owner/type/name',
    },
    index: {
      type: 'string',
      alias: 'i',
      default: defaultIndexPath,
      description: 'Path to a registry index JSON file',
    },
    version: {
      type: 'string',
      alias: 'v',
      description: 'Version to show; defaults to the latest version',
    },
    json: {
      type: 'boolean',
      description: 'Print JSON instead of formatted Markdown',
    },
  },
  async run({ args }) {
    try {
      const result = await readResourceVersion(args.index, args.resource, args.version);

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
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  },
});

const main = defineCommand({
  meta: {
    name: 'aid',
    version: '0.0.0',
    description: 'AI Directory resource registry',
  },
  subCommands: { list, show },
});

runMain(main);
