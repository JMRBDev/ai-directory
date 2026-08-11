#!/usr/bin/env bun

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { defineCommand, runMain } from 'citty';
import {
  clearConfigFile,
  getConfigPath,
  getRepositorySetting,
  readConfigFile,
  resolveRepository,
  writeConfigFile,
  type ConfigScope,
} from '@ai-directory/config';
import { cancel, intro, isCancel, outro, select, spinner, text } from '@clack/prompts';
import { resourceKey } from '@ai-directory/domain';
import { installClaudeCodeResources } from '@ai-directory/installers';
import {
  fetchRegistryIndex,
  readRegistryIndex,
  readRemoteRegistryIndex,
  readRemoteResource,
  readResourceVersion,
  readTemplateResources,
  submitResource,
  validateRegistry,
  validateRemoteRegistry,
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
    repository: {
      type: 'string',
      ...(defaultRepositoryUrl ? { default: defaultRepositoryUrl } : {}),
      description: 'Git repository URL; uses a temporary sparse checkout',
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
      const repository = resolveRepository(args.repository);
      const index = args.remote
        ? await fetchRegistryIndex(args.remote)
        : repository && args.index === defaultIndexPath
          ? await readRemoteRegistryIndex({ repositoryUrl: repository })
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
    repository: {
      type: 'string',
      ...(defaultRepositoryUrl ? { default: defaultRepositoryUrl } : {}),
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
      const repository = resolveRepository(args.repository);
      const remote = repository
        ? await readRemoteResource({
            repositoryUrl: repository,
            resourceId: args.resource,
            version: args.version,
            baseBranch: args.base,
          })
        : undefined;
      const result =
        remote?.resource ??
        (await readResourceVersion(args.index ?? defaultIndexPath, args.resource, args.version));

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
    description: 'Validate the configured remote registry or a local index',
  },
  args: {
    index: {
      type: 'string',
      alias: 'i',
      description: 'Path to a local registry index JSON file; overrides remote checking',
    },
    repository: {
      type: 'string',
      ...(defaultRepositoryUrl ? { default: defaultRepositoryUrl } : {}),
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
      const indexPath = args.index ?? defaultIndexPath;
      const repository = resolveRepository(args.repository);
      const remote = Boolean(
        repository && !args.index && !process.env.AI_DIRECTORY_REGISTRY_INDEX,
      );
      const result = remote
        ? await validateRemoteRegistry({
            repositoryUrl: repository,
            baseBranch: args.base,
          })
        : await validateRegistry(indexPath);

      if (result.issues.length > 0) {
        console.error(`Registry check failed with ${result.issues.length} issue(s):`);
        for (const issue of result.issues) {
          console.error(`- ${issue}`);
        }
        process.exitCode = 1;
        return;
      }

      console.log(
        `Registry is valid. Checked ${result.resourceCount} resource(s)${remote ? ' from the configured remote repository' : ` at ${indexPath}`}.`,
      );
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
      const repository = resolveRepository(args.repository);
      const result = await submitResource({
        indexPath: args.index ?? defaultIndexPath,
        sourceDirectory: args.source,
        resourceId: args.id,
        version: args.version,
        description: args.description,
        baseBranch: args.base,
        remote: args.remote,
        ...(repository ? { repositoryUrl: repository } : {}),
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
    repository: {
      type: 'string',
      ...(defaultRepositoryUrl ? { default: defaultRepositoryUrl } : {}),
      description: 'Git repository URL; uses a temporary sparse checkout',
    },
    base: {
      type: 'string',
      default: 'main',
      description: 'Production branch to read from',
    },
    force: {
      type: 'boolean',
      description: 'Overwrite files already installed at the destination',
    },
  },
  async run({ args }) {
    try {
      const indexPath = args.index ?? defaultIndexPath;
      const repository = resolveRepository(args.repository);
      const remote = repository
        ? await readRemoteResource({
            repositoryUrl: repository,
            resourceId: args.resource,
            version: args.version,
            baseBranch: args.base,
          })
        : undefined;
      const result =
        remote?.resource ??
        (await readResourceVersion(indexPath, args.resource, args.version));

      if (args.harness !== 'claude-code') {
        throw new Error(`Unsupported harness: ${args.harness}`);
      }

      const resources = remote
        ? remote.resources
        : result.resource.type === 'templates'
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
    'api-port': {
      type: 'string',
      default: '4317',
      description: 'Port for the local configuration API',
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
    const apiPort = args['api-port'] ?? '4317';
    const apiUrl = `http://127.0.0.1:${apiPort}`;
    const api = Bun.spawn(['pnpm', '--filter', '@ai-directory/api', 'dev'], {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        AI_DIRECTORY_CONFIG_CWD: process.cwd(),
        AI_DIRECTORY_PORT: apiPort,
      },
      stderr: 'inherit',
      stdout: 'inherit',
    });

    try {
      await waitForLocalApi(`${apiUrl}/health`);

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
      console.log(`Local configuration API: ${apiUrl}`);
      console.log(`Registry index: ${indexPath}`);

      const child = Bun.spawn(command, {
        cwd: webDirectory,
        env: {
          ...process.env,
          AI_DIRECTORY_REGISTRY_INDEX: indexPath,
          AI_DIRECTORY_CONFIG_CWD: process.cwd(),
          PUBLIC_AI_DIRECTORY_API_URL: apiUrl,
        },
        stderr: 'inherit',
        stdout: 'inherit',
      });

      const exitCode = await child.exited;

      if (exitCode !== 0) {
        console.error(`Local website exited with code ${exitCode}.`);
        process.exitCode = exitCode;
      }
    } finally {
      api.kill();
      await api.exited;
    }
  },
});

async function waitForLocalApi(url: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The API process may need a few moments to start.
    }

    await Bun.sleep(100);
  }

  throw new Error(`Local configuration API did not start at ${url}.`);
}

const setup = defineCommand({
  meta: {
    name: 'setup',
    description: 'Connect AI Directory to a registry Git repository',
  },
  args: {
    repository: {
      type: 'string',
      description: 'Registry Git URL; skips the repository prompt',
    },
    scope: {
      type: 'enum',
      options: ['user', 'project'],
      description: 'Config scope; skips the scope prompt',
    },
    'non-interactive': {
      type: 'boolean',
      description: 'Require flags and do not show prompts',
    },
    'skip-check': {
      type: 'boolean',
      description: 'Save the repository without checking Git access',
    },
  },
  async run({ args }) {
    const nonInteractive = args['non-interactive'] ?? false;
    const existing = getRepositorySetting();

    try {
      if (!nonInteractive) intro('AI Directory setup');

      let repository = args.repository?.trim() || existing.value;

      if (!args.repository && !nonInteractive) {
        const answer = await text({
          message: 'What is the registry Git URL?',
          placeholder: 'git@github.com:company/ai-directory-registry.git',
          ...(existing.value ? { initialValue: existing.value } : {}),
          validate(value) {
            if (!value.trim()) return 'A registry Git URL is required.';
          },
        });

        if (isCancel(answer)) {
          cancel('Setup cancelled.');
          return;
        }

        repository = answer.trim();
      }

      if (!repository) {
        throw new Error(
          'No registry repository configured. Pass --repository or run setup interactively.',
        );
      }

      let scope: ConfigScope;

      if (args.scope) {
        scope = args.scope as ConfigScope;
      } else if (nonInteractive) {
        scope = 'user';
      } else {
        const answer = await select({
          message: 'Where should this configuration apply?',
          options: [
            { value: 'user', label: 'This user', hint: 'Use it across projects' },
            { value: 'project', label: 'This project', hint: 'Save it in .ai-directory/config.json' },
          ],
        });

        if (isCancel(answer)) {
          cancel('Setup cancelled.');
          return;
        }

        scope = answer as ConfigScope;
      }

      if (!args['skip-check']) {
        const progress = spinner();
        progress.start('Checking Git access and reading the production registry');

        try {
          const index = await readRemoteRegistryIndex({ repositoryUrl: repository });
          progress.stop(`Connected. Found ${index.resources.length} resource(s).`);
        } catch (error) {
          progress.stop('Could not read the registry.');
          throw error;
        }
      }

      const path = getConfigPath(scope);
      const current = readConfigFile(path);
      await writeConfigFile(path, { ...current, repository });

      if (!nonInteractive) {
        outro(`Saved the registry repository in the ${scope} config.`);
      } else {
        console.log(`Saved the registry repository in the ${scope} config: ${path}`);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  },
});

const doctor = defineCommand({
  meta: {
    name: 'doctor',
    description: 'Check registry configuration and Git access',
  },
  args: {
    repository: {
      type: 'string',
      description: 'Registry Git URL override',
    },
    base: {
      type: 'string',
      default: 'main',
      description: 'Production branch to check',
    },
    json: {
      type: 'boolean',
      description: 'Print machine-readable diagnostics',
    },
  },
  async run({ args }) {
    const setting = getRepositorySetting(args.repository);
    const diagnostics: {
      ok: boolean;
      repository: string | null;
      source: string;
      branch: string;
      resourceCount?: number;
      activeCount?: number;
      unreviewedCount?: number;
      error?: string;
    } = {
      ok: false,
      repository: setting.value ?? null,
      source: setting.source,
      branch: args.base ?? 'main',
    };

    if (!setting.value) {
      diagnostics.error = 'No registry repository is configured. Run aid setup.';
    } else {
      try {
        const index = await readRemoteRegistryIndex({
          repositoryUrl: setting.value,
          baseBranch: args.base,
        });
        diagnostics.ok = true;
        diagnostics.resourceCount = index.resources.length;
        diagnostics.activeCount = index.resources.filter(
          (resource) => resource.lifecycleStatus === 'active',
        ).length;
        diagnostics.unreviewedCount = index.resources.filter(
          (resource) => resource.reviewStatus === 'unreviewed',
        ).length;
      } catch (error) {
        diagnostics.error = error instanceof Error ? error.message : String(error);
      }
    }

    if (args.json) {
      console.log(JSON.stringify(diagnostics, null, 2));
    } else {
      console.log(`Repository: ${diagnostics.repository ?? 'not configured'}`);
      console.log(`Source: ${diagnostics.source}`);
      console.log(`Branch: ${diagnostics.branch}`);

      if (diagnostics.ok) {
        console.log(`Registry: reachable (${diagnostics.resourceCount} resource(s))`);
        console.log(`Active: ${diagnostics.activeCount}`);
        console.log(`Unreviewed: ${diagnostics.unreviewedCount}`);
      } else {
        console.error(`Registry: unavailable. ${diagnostics.error}`);
      }
    }

    if (!diagnostics.ok) process.exitCode = 1;
  },
});

function assertConfigKey(key: string): asserts key is 'repository' {
  if (key !== 'repository') {
    throw new Error(`Unknown config key: ${key}. Supported key: repository.`);
  }
}

const configGet = defineCommand({
  meta: {
    name: 'get',
    description: 'Show the configured registry repository',
  },
  args: {
    key: {
      type: 'positional',
      required: true,
      description: 'Configuration key: repository',
    },
    scope: {
      type: 'enum',
      options: ['user', 'project'],
      description: 'Read a stored value from one config scope',
    },
  },
  run({ args }) {
    assertConfigKey(args.key);

    if (args.scope) {
      const scope = args.scope as ConfigScope;
      const value = readConfigFile(getConfigPath(scope)).repository;
      console.log(value ?? `Repository is not configured in the ${scope} config.`);
      return;
    }

    const setting = getRepositorySetting();
    console.log(`Repository: ${setting.value ?? 'not configured'}`);
    console.log(`Source: ${setting.source}`);
  },
});

const configSet = defineCommand({
  meta: {
    name: 'set',
    description: 'Set the default registry repository',
  },
  args: {
    key: {
      type: 'positional',
      required: true,
      description: 'Configuration key: repository',
    },
    value: {
      type: 'positional',
      required: true,
      description: 'Repository Git URL',
    },
    scope: {
      type: 'enum',
      options: ['user', 'project'],
      default: 'user',
      description: 'Config scope to update',
    },
  },
  async run({ args }) {
    assertConfigKey(args.key);
    const value = args.value.trim();

    if (!value) throw new Error('Repository URL cannot be empty.');

    const scope = args.scope as ConfigScope;
    const path = getConfigPath(scope);
    const current = readConfigFile(path);

    await writeConfigFile(path, { ...current, repository: value });
    console.log(`Saved repository in the ${scope} config: ${path}`);
  },
});

const configClear = defineCommand({
  meta: {
    name: 'clear',
    description: 'Remove the configured registry repository',
  },
  args: {
    key: {
      type: 'positional',
      required: true,
      description: 'Configuration key: repository',
    },
    scope: {
      type: 'enum',
      options: ['user', 'project'],
      default: 'user',
      description: 'Config scope to update',
    },
  },
  async run({ args }) {
    assertConfigKey(args.key);

    const scope = args.scope as ConfigScope;
    const path = getConfigPath(scope);
    await clearConfigFile(path);
    console.log(`Cleared repository from the ${scope} config: ${path}`);
  },
});

const configPath = defineCommand({
  meta: {
    name: 'path',
    description: 'Show the config file path',
  },
  args: {
    scope: {
      type: 'enum',
      options: ['user', 'project'],
      default: 'user',
      description: 'Config scope',
    },
  },
  run({ args }) {
    console.log(getConfigPath(args.scope as ConfigScope));
  },
});

const config = defineCommand({
  meta: {
    name: 'config',
    description: 'Configure the default registry repository',
  },
  subCommands: { get: configGet, set: configSet, clear: configClear, path: configPath },
});

const main = defineCommand({
  meta: {
    name: 'aid',
    version: '0.0.0',
    description: 'AI Directory resource registry',
  },
  subCommands: { list, show, check, submit, install, web, setup, doctor, config },
});

runMain(main);
