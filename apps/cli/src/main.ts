#!/usr/bin/env bun

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineCommand, runMain, showUsage } from 'citty';
import {
  CONFIG_OPTIONS,
  clearConfigFile,
  findWorkspaceRoot,
  getConfigPath,
  getInstallManifestPath,
  getRepositorySetting,
  readConfigFile,
  resolveRepository,
  writeConfigFile,
  type ConfigKey,
  type ConfigScope,
} from '@ai-directory/config';
import { cancel, intro, isCancel, outro, select, spinner, text } from '@clack/prompts';
import { resourceKey } from '@ai-directory/domain';
import {
  assertInstallationFilesUnchanged,
  createInstallationRecords,
  detectHarnesses,
  getHarnessAdapter,
  readInstallationManifest,
  removeInstallationRecord,
  saveInstallationRecords,
  uninstallInstallation,
  type Harness,
  type HarnessDetection,
  type InstallScope,
} from '@ai-directory/installers';
import {
  readRemoteRegistryIndex,
  readRegistrySourceIndex,
  readRegistrySourceResource,
  resolveRegistrySource,
  submitResource,
  validateRegistrySource,
} from '@ai-directory/registry';

const localIndexPath = process.env.AI_DIRECTORY_REGISTRY_INDEX;

function getRegistrySource(indexPath?: string, repository?: string, baseBranch?: string) {
  const repositoryUrl = resolveRepository(repository);
  const sourceOptions: {
    indexPath?: string;
    repositoryUrl?: string;
    baseBranch?: string;
  } = {};
  const localPath = indexPath ?? (repository?.trim() ? undefined : localIndexPath);

  if (localPath) sourceOptions.indexPath = localPath;
  if (repositoryUrl) sourceOptions.repositoryUrl = repositoryUrl;
  if (baseBranch) sourceOptions.baseBranch = baseBranch;

  return resolveRegistrySource(sourceOptions);
}

function parseHarnesses(value: string | undefined, rawArgs: string[]): Harness[] {
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
  const harnesses = [...new Set(values)];

  if (harnesses.length === 0) {
    throw new Error('Select one or more harnesses with --harness.');
  }

  if (harnesses.some((harness) => !isHarness(harness))) {
    throw new Error(
      `Unsupported harness. Choose one or more of: claude-code, opencode, codex.`,
    );
  }

  return harnesses as Harness[];
}

function isHarness(value: string): value is Harness {
  return value === 'claude-code' || value === 'opencode' || value === 'codex';
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
      description: 'Local registry index path; overrides the configured Git repository',
    },
    repository: {
      type: 'string',
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
      const result = (
        await readRegistrySourceResource(source, args.resource, args.version)
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
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  },
});

const check = defineCommand({
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
      const source = getRegistrySource(args.index, args.repository, args.base);
      const result = await submitResource({
        ...(source.type === 'local' ? { indexPath: source.indexPath } : {}),
        sourceDirectory: args.source,
        resourceId: args.id,
        version: args.version,
        description: args.description,
        baseBranch: args.base,
        remote: args.remote,
        ...(source.type === 'remote' ? { repositoryUrl: source.repositoryUrl } : {}),
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
    description: 'Install a resource for one or more coding harnesses',
  },
  args: {
    resource: {
      type: 'positional',
      required: true,
      description: 'Resource ID: owner/type/name',
    },
    harness: {
      type: 'string',
      default: 'claude-code',
      valueHint: 'harness[,harness...]',
      description: 'Harnesses to install for; repeat or separate with commas',
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
      description: 'Local registry index path; overrides the configured Git repository',
    },
    version: {
      type: 'string',
      alias: 'v',
      description: 'Version to install; defaults to the latest version',
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
    force: {
      type: 'boolean',
      description: 'Overwrite files already installed at the destination',
    },
  },
  async run({ args, rawArgs }) {
    try {
      const harnesses = parseHarnesses(args.harness, rawArgs);
      const source = getRegistrySource(args.index, args.repository, args.base);
      const loaded = await readRegistrySourceResource(source, args.resource, args.version);
      const result = loaded.resource;

      const resources = loaded.resources;

      for (const resource of [result, ...resources]) {
        if (resource.resource.reviewStatus === 'unreviewed') {
          console.warn(
            `Warning: ${resourceKey(resource.resource)}@${resource.version} has not been reviewed.`,
          );
        }
      }

      const manifestPath = getInstallManifestPath(args.scope);

      for (const harness of harnesses) {
        const installer = getHarnessAdapter(harness);
        const installations = await installer.install(resources, {
          scope: args.scope,
          force: args.force ?? false,
        });
        const records = createInstallationRecords(resources, installations, args.scope, harness);
        await saveInstallationRecords(manifestPath, records, {
          scope: args.scope,
          force: args.force ?? false,
        });

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
      }

      if (result.resource.type === 'templates') {
        console.log(
          `Installed ${resourceKey(result.resource)}@${result.version} with ${resources.length} resource(s) for ${harnesses.join(', ')}.`,
        );
      } else {
        console.log(
          `Installed ${resourceKey(result.resource)}@${result.version} for ${harnesses.join(', ')}.`,
        );
      }
      console.log(`Tracked in: ${manifestPath}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  },
});

const installed = defineCommand({
  meta: {
    name: 'installed',
    description: 'List installed resources',
  },
  args: {
    scope: {
      type: 'enum',
      options: ['project', 'global'],
      description: 'Limit results to one installation scope',
    },
    json: {
      type: 'boolean',
      description: 'Print JSON instead of a table',
    },
  },
  async run({ args }) {
    try {
      const scopes: InstallScope[] = args.scope
        ? [args.scope]
        : ['project', 'global'];
      const records = (
        await Promise.all(
          scopes.map(async (scope) => (await readInstallationManifest(getInstallManifestPath(scope))).installations),
        )
      )
        .flat()
        .sort((left, right) => left.resource.localeCompare(right.resource));

      if (args.json) {
        console.log(JSON.stringify(records, null, 2));
        return;
      }

      if (records.length === 0) {
        console.log('No installed resources found.');
        return;
      }

      for (const record of records) {
        console.log(
          `${record.resource}\t${record.version}\t${record.harness}\t${record.scope}\t${record.destination}`,
        );
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  },
});

const update = defineCommand({
  meta: {
    name: 'update',
    description: 'Update an installed resource to its latest version',
  },
  args: {
    resource: {
      type: 'positional',
      required: true,
      description: 'Resource ID: owner/type/name',
    },
    harness: {
      type: 'string',
      default: 'claude-code',
      valueHint: 'harness[,harness...]',
      description: 'Harnesses to update; repeat or separate with commas',
    },
    scope: {
      type: 'enum',
      options: ['project', 'global'],
      required: true,
      description: 'Installation scope to update',
    },
    index: {
      type: 'string',
      alias: 'i',
      description: 'Local registry index path; overrides the configured Git repository',
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
    force: {
      type: 'boolean',
      description: 'Continue when managed files were modified',
    },
  },
  async run({ args, rawArgs }) {
    try {
      const harnesses = parseHarnesses(args.harness, rawArgs);

      const scope = args.scope as InstallScope;
      const manifestPath = getInstallManifestPath(scope);
      const manifest = await readInstallationManifest(manifestPath);
      const existing = harnesses.map((harness) =>
        manifest.installations.find(
          (record) =>
            record.resource === args.resource &&
            record.harness === harness &&
            record.scope === scope,
        ),
      );

      if (existing.some((record) => !record)) {
        const missing = harnesses.filter((_, index) => !existing[index]);
        throw new Error(
          `${args.resource} is not installed for ${missing.join(', ')} in the ${scope} scope.`,
        );
      }

      const existingRecords = existing.filter(
        (record): record is NonNullable<typeof record> => record !== undefined,
      );
      for (const record of existingRecords) {
        await assertInstallationFilesUnchanged(record, args.force ?? false);
      }

      const source = getRegistrySource(args.index, args.repository, args.base);
      const loaded = await readRegistrySourceResource(source, args.resource);

      if (loaded.resource.resource.type === 'templates') {
        throw new Error('Templates are updated through their installed resources.');
      }

      for (const resource of [loaded.resource, ...loaded.resources]) {
        if (resource.resource.reviewStatus === 'unreviewed') {
          console.warn(
            `Warning: ${resourceKey(resource.resource)}@${resource.version} has not been reviewed.`,
          );
        }
      }

      const updatedHarnesses: Harness[] = [];

      for (const [index, harness] of harnesses.entries()) {
        const record = existingRecords[index];

        if (!record) continue;

        if (loaded.resource.version === record.version) {
          console.log(`${args.resource} is already at the latest version for ${harness} (${record.version}).`);
          continue;
        }

        const installer = getHarnessAdapter(harness);
        const installations = await installer.install(loaded.resources, {
          scope,
          force: true,
        });
        const records = createInstallationRecords(loaded.resources, installations, scope, harness);
        await saveInstallationRecords(manifestPath, records, {
          scope,
          force: args.force ?? false,
        });
        updatedHarnesses.push(harness);
      }

      if (updatedHarnesses.length > 0) {
        console.log(
          `Updated ${args.resource} to ${loaded.resource.version} for ${updatedHarnesses.join(', ')}.`,
        );
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  },
});

const uninstall = defineCommand({
  meta: {
    name: 'uninstall',
    description: 'Remove an installed resource',
  },
  args: {
    resource: {
      type: 'positional',
      required: true,
      description: 'Resource ID: owner/type/name',
    },
    harness: {
      type: 'string',
      default: 'claude-code',
      valueHint: 'harness[,harness...]',
      description: 'Harnesses to uninstall from; repeat or separate with commas',
    },
    scope: {
      type: 'enum',
      options: ['project', 'global'],
      required: true,
      description: 'Installation scope to change',
    },
    force: {
      type: 'boolean',
      description: 'Continue when managed files were modified',
    },
  },
  async run({ args, rawArgs }) {
    try {
      const harnesses = parseHarnesses(args.harness, rawArgs);
      const scope = args.scope as InstallScope;
      const manifestPath = getInstallManifestPath(scope);
      const manifest = await readInstallationManifest(manifestPath);
      const existing = harnesses.map((harness) =>
        manifest.installations.find(
          (record) =>
            record.resource === args.resource &&
            record.harness === harness &&
            record.scope === scope,
        ),
      );

      if (existing.some((record) => !record)) {
        const missing = harnesses.filter((_, index) => !existing[index]);
        throw new Error(
          `${args.resource} is not installed for ${missing.join(', ')} in the ${scope} scope.`,
        );
      }

      const existingRecords = existing.filter(
        (record): record is NonNullable<typeof record> => record !== undefined,
      );
      for (const record of existingRecords) {
        await assertInstallationFilesUnchanged(record, args.force ?? false);
      }
      for (const record of existingRecords) {
        await uninstallInstallation(record, {
          scope,
          force: args.force ?? false,
        });
        await removeInstallationRecord(manifestPath, record);
      }

      console.log(`Uninstalled ${args.resource} for ${harnesses.join(', ')}.`);
      console.log(`Updated: ${manifestPath}`);
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
      description: 'Local registry index path; overrides the configured Git repository',
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

    const indexPath = args.index ? resolve(workspaceRoot, args.index) : undefined;
    const apiPort = args['api-port'] ?? '4317';
    const apiUrl = `http://127.0.0.1:${apiPort}`;
    const api = Bun.spawn(['pnpm', '--filter', '@ai-directory/api', 'dev'], {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        AI_DIRECTORY_CONFIG_CWD: process.cwd(),
        AI_DIRECTORY_PORT: apiPort,
        ...(indexPath ? { AI_DIRECTORY_REGISTRY_INDEX: indexPath } : {}),
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
      console.log(`Registry source: ${indexPath ?? 'configured Git repository'}`);

      const child = Bun.spawn(command, {
        cwd: webDirectory,
        env: {
          ...process.env,
          AI_DIRECTORY_CONFIG_CWD: process.cwd(),
          PUBLIC_AI_DIRECTORY_API_URL: apiUrl,
          ...(indexPath ? { AI_DIRECTORY_REGISTRY_INDEX: indexPath } : {}),
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
            if (!value?.trim()) return 'A registry Git URL is required.';
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
      harnesses: HarnessDetection[];
      error?: string;
    } = {
      ok: false,
      repository: setting.value ?? null,
      source: setting.source,
      branch: args.base ?? 'main',
      harnesses: await detectHarnesses(),
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
      console.log('Harnesses:');

      for (const harness of diagnostics.harnesses) {
        const signals = [
          harness.executable ? `command=${harness.executable}` : undefined,
          ...harness.project.paths.map((path) => `project=${path}`),
          ...harness.global.paths.map((path) => `global=${path}`),
        ].filter((signal): signal is string => signal !== undefined);

        console.log(`  ${harness.displayName}: ${signals.join(', ') || 'not detected'}`);
      }

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

function assertConfigKey(key: string): asserts key is ConfigKey {
  if (!CONFIG_OPTIONS.some((option) => option.key === key)) {
    throw new Error(
      `Unknown config key: ${key}. Supported keys: ${CONFIG_OPTIONS.map((option) => option.key).join(', ')}.`,
    );
  }
}

const configList = defineCommand({
  meta: {
    name: 'list',
    description: 'List available configuration options',
  },
  run() {
    console.log('Available configuration options:');

    for (const option of CONFIG_OPTIONS) {
      console.log(`\n${option.key}`);
      console.log(`  ${option.description}`);
    }

    console.log('\nUse `aid config get <key>` to inspect the effective value.');
  },
});

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
    description: 'Manage AI Directory configuration',
  },
  run({ rawArgs }) {
    if (rawArgs.length === 0) return showUsage(config, main);
  },
  subCommands: {
    list: configList,
    get: configGet,
    set: configSet,
    clear: configClear,
    path: configPath,
  },
});

const main = defineCommand({
  meta: {
    name: 'aid',
    version: '0.0.0',
    description: 'AI Directory resource registry',
  },
  subCommands: {
    list,
    show,
    check,
    submit,
    install,
    installed,
    update,
    uninstall,
    web,
    setup,
    doctor,
    config,
  },
});

runMain(main);
