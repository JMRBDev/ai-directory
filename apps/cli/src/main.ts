#!/usr/bin/env bun

import { defineCommand, runMain } from 'citty';
import { resourceKey } from '@ai-directory/domain';
import { installClaudeCodeResource } from '@ai-directory/installers';
import {
  fetchRegistryIndex,
  readRegistryIndex,
  readResourceVersion,
  validateRegistry,
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
      ...(defaultIndexUrl ? { default: defaultIndexUrl } : {}),
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
        : await readRegistryIndex(args.index ?? defaultIndexPath);
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
      const result = await readResourceVersion(
        args.index ?? defaultIndexPath,
        args.resource,
        args.version,
      );

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

const check = defineCommand({
  meta: {
    name: 'check',
    description: 'Validate the local registry index and resource packages',
  },
  args: {
    index: {
      type: 'string',
      alias: 'i',
      default: defaultIndexPath,
      description: 'Path to a registry index JSON file',
    },
  },
  async run({ args }) {
    try {
      const result = await validateRegistry(args.index ?? defaultIndexPath);

      if (result.issues.length > 0) {
        console.error(`Registry check failed with ${result.issues.length} issue(s):`);
        for (const issue of result.issues) {
          console.error(`- ${issue}`);
        }
        process.exitCode = 1;
        return;
      }

      console.log(`Registry is valid. Checked ${result.resourceCount} resource(s).`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  },
});

const install = defineCommand({
  meta: {
    name: 'install',
    description: 'Install a resource for a coding harness',
  },
  args: {
    resource: {
      type: 'positional',
      required: true,
      description: 'Resource ID: owner/type/name',
    },
    harness: {
      type: 'enum',
      options: ['claude-code'],
      default: 'claude-code',
      description: 'Coding harness to install for',
    },
    scope: {
      type: 'enum',
      options: ['project', 'global'],
      required: true,
      description: 'Install for the current project or user',
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
      description: 'Version to install; defaults to the latest version',
    },
    force: {
      type: 'boolean',
      description: 'Overwrite files already installed at the destination',
    },
  },
  async run({ args }) {
    try {
      const result = await readResourceVersion(
        args.index ?? defaultIndexPath,
        args.resource,
        args.version,
      );

      if (args.harness !== 'claude-code') {
        throw new Error(`Unsupported harness: ${args.harness}`);
      }

      if (result.resource.reviewStatus === 'unreviewed') {
        console.warn('Warning: This resource has not been reviewed.');
      }

      const installation = await installClaudeCodeResource(result, {
        scope: args.scope,
        force: args.force ?? false,
      });

      console.log(`Installed ${resourceKey(result.resource)}@${result.version} for Claude Code.`);
      console.log(`Location: ${installation.destination}`);
      console.log(`Files: ${installation.files.join(', ')}`);
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
  subCommands: { list, show, check, install },
});

runMain(main);
