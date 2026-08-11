#!/usr/bin/env bun

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { defineCommand, runMain } from 'citty';
import { resourceKey } from '@ai-directory/domain';
import { installClaudeCodeResources } from '@ai-directory/installers';
import {
  fetchRegistryIndex,
  readRegistryIndex,
  readResourceVersion,
  readTemplateResources,
  submitResource,
  validateRegistry,
} from '@ai-directory/registry';

const defaultIndexPath = process.env.AI_DIRECTORY_REGISTRY_INDEX ?? '.ai-directory/registry/index.json';
const defaultIndexUrl = process.env.AI_DIRECTORY_REGISTRY_INDEX_URL;
const defaultRepositoryUrl = process.env.AI_DIRECTORY_REGISTRY_REPOSITORY;

function findWorkspaceRoot(startDirectory: string): string | null {
  let directory = resolve(startDirectory);

  while (true) {
    if (existsSync(join(directory, 'pnpm-workspace.yaml'))) return directory;

    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

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

const submit = defineCommand({
  meta: {
    name: 'submit',
    description: 'Submit a prepared resource directory as a pull request',
  },
  args: {
    source: {
      type: 'positional',
      required: true,
      description: 'Directory containing the resource entry file and supporting files',
    },
    id: {
      type: 'string',
      required: true,
      description: 'Resource ID: owner/type/name',
    },
    version: {
      type: 'string',
      alias: 'v',
      required: true,
      description: 'New semantic version to publish',
    },
    description: {
      type: 'string',
      required: true,
      description: 'Short description shown in the registry',
    },
    index: {
      type: 'string',
      alias: 'i',
      default: defaultIndexPath,
      description: 'Path to a registry index JSON file',
    },
    repository: {
      type: 'string',
      ...(defaultRepositoryUrl ? { default: defaultRepositoryUrl } : {}),
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
      const result = await submitResource({
        indexPath: args.index ?? defaultIndexPath,
        sourceDirectory: args.source,
        resourceId: args.id,
        version: args.version,
        description: args.description,
        baseBranch: args.base,
        remote: args.remote,
        ...(args.repository !== undefined ? { repositoryUrl: args.repository } : {}),
        ...(args.branch !== undefined ? { branch: args.branch } : {}),
        ...(args.title !== undefined ? { title: args.title } : {}),
        ...(args.body !== undefined ? { body: args.body } : {}),
      });

      console.log(
        `Submitted ${resourceKey(result.resource)}@${result.resource.latestVersion} as Unreviewed.`,
      );
      console.log(`Branch: ${result.branch}`);
      console.log(`Commit: ${result.commit}`);
      console.log(`Pull request: ${result.pullRequestUrl}`);
      console.log(`Files: ${result.files.join(', ')}`);
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
      const indexPath = args.index ?? defaultIndexPath;
      const result = await readResourceVersion(indexPath, args.resource, args.version);

      if (args.harness !== 'claude-code') {
        throw new Error(`Unsupported harness: ${args.harness}`);
      }

      const resources =
        result.resource.type === 'templates'
          ? await readTemplateResources(indexPath, result)
          : [result];

      for (const resource of [result, ...resources]) {
        if (resource.resource.reviewStatus === 'unreviewed') {
          console.warn(
            `Warning: ${resourceKey(resource.resource)}@${resource.version} has not been reviewed.`,
          );
        }
      }

      const installations = await installClaudeCodeResources(resources, {
        scope: args.scope,
        force: args.force ?? false,
      });

      if (result.resource.type === 'templates') {
        console.log(
          `Installed ${resourceKey(result.resource)}@${result.version} with ${resources.length} resource(s) for Claude Code.`,
        );
      } else {
        console.log(`Installed ${resourceKey(result.resource)}@${result.version} for Claude Code.`);
      }

      for (const [index, resource] of resources.entries()) {
        const installation = installations[index];

        if (!installation) {
          throw new Error(`Installation result missing for ${resourceKey(resource.resource)}.`);
        }

        console.log(
          `Location: ${installation.destination} (${resourceKey(resource.resource)}@${resource.version})`,
        );
        console.log(`Files: ${installation.files.join(', ')}`);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  },
});

const web = defineCommand({
  meta: {
    name: 'web',
    description: 'Start the local AI Directory website',
  },
  args: {
    index: {
      type: 'string',
      alias: 'i',
      default: defaultIndexPath,
      description: 'Path to a local registry index JSON file',
    },
    host: {
      type: 'string',
      default: '127.0.0.1',
      description: 'Host for the local website',
    },
    port: {
      type: 'string',
      default: '4321',
      description: 'Port for the local website',
    },
    open: {
      type: 'boolean',
      description: 'Open the website in the default browser',
    },
  },
  async run({ args }) {
    const workspaceRoot = findWorkspaceRoot(process.cwd());

    if (!workspaceRoot) {
      console.error('Could not find the AI Directory workspace from the current directory.');
      process.exitCode = 1;
      return;
    }

    const webDirectory = join(workspaceRoot, 'apps', 'web');

    if (!existsSync(webDirectory)) {
      console.error(`Website directory not found: ${webDirectory}`);
      process.exitCode = 1;
      return;
    }

    const indexPath = resolve(workspaceRoot, args.index ?? defaultIndexPath);
    const command = [
      'pnpm',
      'dev',
      '--host',
      args.host ?? '127.0.0.1',
      '--port',
      args.port ?? '4321',
      ...(args.open ? ['--open'] : []),
    ];

    console.log(`Starting the local AI Directory website at http://${args.host}:${args.port}`);
    console.log(`Registry index: ${indexPath}`);

    const child = Bun.spawn(command, {
      cwd: webDirectory,
      env: {
        ...process.env,
        AI_DIRECTORY_REGISTRY_INDEX: indexPath,
      },
      stderr: 'inherit',
      stdout: 'inherit',
    });

    const exitCode = await child.exited;

    if (exitCode !== 0) {
      console.error(`Local website exited with code ${exitCode}.`);
      process.exitCode = exitCode;
    }
  },
});

const main = defineCommand({
  meta: {
    name: 'aid',
    version: '0.0.0',
    description: 'AI Directory resource registry',
  },
  subCommands: { list, show, check, submit, install, web },
});

runMain(main);
