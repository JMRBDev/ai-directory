#!/usr/bin/env bun

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { defineCommand, runCommand, runMain, showUsage } from 'citty';
import {
  resourceIdSchema,
  resourceTypeSchema,
  resourceVersionSchema,
  type ResourceType,
} from '@ai-directory/contracts';
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
import {
  autocomplete,
  autocompleteMultiselect,
  cancel,
  confirm,
  intro,
  isCancel,
  outro,
  select,
  spinner,
  text,
} from '@clack/prompts';
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
  type InstallResult,
  type InstallationRecord,
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

const resourceTypeOptions = [
  { value: 'skills' as const, label: 'Skill', hint: 'Reusable instructions and workflows' },
  { value: 'agents' as const, label: 'Agent', hint: 'A reusable specialist agent' },
  { value: 'rules' as const, label: 'Rules', hint: 'Guidance applied to coding work' },
  { value: 'templates' as const, label: 'Template', hint: 'A pack of existing resources' },
];

const entryFiles: Record<ResourceType, string> = {
  skills: 'SKILL.md',
  agents: 'AGENT.md',
  rules: 'RULE.md',
  templates: 'TEMPLATE.md',
};

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

function hasHarnessArgument(rawArgs: string[]): boolean {
  return rawArgs.some(
    (argument) => argument === '--harness' || argument.startsWith('--harness='),
  );
}

function isHarness(value: string): value is Harness {
  return value === 'claude-code' || value === 'opencode' || value === 'codex';
}

const harnessOptions = [
  { value: 'claude-code' as const, label: 'Claude Code', hint: 'Anthropic coding harness' },
  { value: 'opencode' as const, label: 'OpenCode', hint: 'OpenCode agent harness' },
  { value: 'codex' as const, label: 'Codex', hint: 'OpenAI coding agent' },
];

function cancelled(message: string): undefined {
  cancel(message);
  return undefined;
}

function isInteractiveTerminal(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

async function promptRequiredText(
  message: string,
  placeholder: string,
  initialValue?: string,
): Promise<string | undefined> {
  const answer = await text({
    message,
    placeholder,
    ...(initialValue ? { initialValue } : {}),
    validate(value) {
      if (!value?.trim()) return 'This value is required.';
    },
  });

  return isCancel(answer) ? cancelled('Operation cancelled.') : answer.trim();
}

function isResourceType(value: string): value is ResourceType {
  return resourceTypeSchema.safeParse(value).success;
}

function isSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function resourceTitle(name: string): string {
  return name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

type TemplateComponent = {
  id: string;
  version: string;
};

function parseTemplateComponents(value: string): TemplateComponent[] {
  const components = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const separator = item.lastIndexOf('@');
      const id = separator > 0 ? item.slice(0, separator) : '';
      const version = separator > 0 ? item.slice(separator + 1) : '';

      if (
        !resourceIdSchema.safeParse(id).success ||
        id.includes('/templates/') ||
        !resourceVersionSchema.safeParse(version).success
      ) {
        throw new Error(
          `Invalid template component: ${item}. Use owner/type/name@version.`,
        );
      }

      return { id, version };
    });

  if (components.length === 0) {
    throw new Error('A template needs at least one component resource.');
  }

  const unique = new Map(components.map((component) => [component.id, component]));

  if (unique.size !== components.length) {
    throw new Error('A template cannot contain the same component resource twice.');
  }

  return [...unique.values()];
}

async function promptResourceType(): Promise<ResourceType | undefined> {
  const answer = await select({
    message: 'What kind of resource are you creating?',
    options: resourceTypeOptions,
  });

  return isCancel(answer) ? cancelled('Operation cancelled.') : answer;
}

async function promptSlug(message: string, placeholder: string): Promise<string | undefined> {
  return promptRequiredText(message, placeholder);
}

async function promptTemplateComponents(
  source: ReturnType<typeof resolveRegistrySource>,
): Promise<TemplateComponent[] | undefined> {
  const index = await readRegistrySourceIndex(source);
  const resources = index.resources
    .filter((resource) => resource.type !== 'templates' && resource.lifecycleStatus === 'active')
    .sort((left, right) => resourceKey(left).localeCompare(resourceKey(right)));

  if (resources.length === 0) {
    throw new Error('The registry has no active resources available for a template.');
  }

  const answer = await autocompleteMultiselect({
    message: 'Which resources should this template contain?',
    placeholder: 'Type to filter resources',
    options: resources.map((resource) => ({
      value: `${resourceKey(resource)}@${resource.latestVersion}`,
      label: resourceKey(resource),
      hint: `v${resource.latestVersion} · ${resource.description}`,
    })),
    required: true,
  });

  if (isCancel(answer)) return cancelled('Operation cancelled.');
  return parseTemplateComponents(answer.join(','));
}

function scaffoldContent(
  type: ResourceType,
  name: string,
  description: string,
  components: TemplateComponent[],
): string {
  const title = resourceTitle(name);
  const quotedDescription = JSON.stringify(description);

  if (type === 'templates') {
    return [
      '---',
      `name: ${name}`,
      `description: ${quotedDescription}`,
      'resources:',
      ...components.flatMap((component) => [
        `  - id: ${component.id}`,
        `    version: ${component.version}`,
      ]),
      '---',
      '',
      `# ${title}`,
      '',
      description,
      '',
    ].join('\n');
  }

  const frontmatter = type === 'skills' || type === 'agents'
    ? ['---', `name: ${name}`, `description: ${quotedDescription}`, '---', '']
    : [];

  return [
    ...frontmatter,
    `# ${title}`,
    '',
    description,
    '',
    '## Instructions',
    '',
    'Add the instructions, rules, or workflow for this resource here.',
    '',
  ].join('\n');
}

async function createResourceDirectory(options: {
  type: ResourceType;
  owner: string;
  name: string;
  description: string;
  output: string;
  components: TemplateComponent[];
}): Promise<string> {
  const id = `${options.owner}/${options.type}/${options.name}`;

  if (!resourceIdSchema.safeParse(id).success) {
    throw new Error(`Invalid resource ID: ${id}`);
  }

  const output = resolve(options.output);
  if (existsSync(output)) {
    throw new Error(`Output directory already exists: ${output}`);
  }

  await mkdir(output, { recursive: true });
  await writeFile(
    join(output, entryFiles[options.type]),
    scaffoldContent(options.type, options.name, options.description, options.components),
    { encoding: 'utf8', flag: 'wx' },
  );

  return output;
}

async function promptResource(source: ReturnType<typeof resolveRegistrySource>): Promise<string | undefined> {
  const index = await readRegistrySourceIndex(source);
  const resources = index.resources
    .filter((resource) => resource.lifecycleStatus === 'active')
    .sort((left, right) => resourceKey(left).localeCompare(resourceKey(right)));

  if (resources.length === 0) throw new Error('The registry has no active resources.');

  const answer = await autocomplete({
    message: 'Which resource do you want to use?',
    placeholder: 'Type to search by name, owner, or description',
    maxItems: 8,
    options: resources.map((resource) => ({
      value: resourceKey(resource),
      label: resourceKey(resource),
      hint: `${resource.description} · ${resource.reviewStatus}`,
    })),
  });

  return isCancel(answer) ? cancelled('Operation cancelled.') : answer;
}

async function promptHarnesses(initialValues?: Harness[]): Promise<Harness[] | undefined> {
  const answer = await autocompleteMultiselect({
    message: 'Which coding harnesses should be configured?',
    placeholder: 'Type to filter harnesses',
    options: harnessOptions,
    ...(initialValues ? { initialValues } : {}),
    required: true,
  });

  return isCancel(answer) ? cancelled('Operation cancelled.') : answer;
}

async function promptScope(initialValue?: InstallScope): Promise<InstallScope | undefined> {
  const answer = await select({
    message: 'Where should this resource be installed?',
    options: [
      { value: 'project' as const, label: 'This project', hint: 'Available in the current project' },
      { value: 'global' as const, label: 'All projects', hint: 'Available in your user setup' },
    ],
    ...(initialValue ? { initialValue } : {}),
  });

  return isCancel(answer) ? cancelled('Operation cancelled.') : answer;
}

async function readInstalledRecords(): Promise<InstallationRecord[]> {
  const scopes: InstallScope[] = ['project', 'global'];
  return (
    await Promise.all(
      scopes.map(async (scope) =>
        (await readInstallationManifest(getInstallManifestPath(scope))).installations,
      ),
    )
  ).flat();
}

type InstalledResourceChoice = {
  resource: string;
  resources: string[];
};

async function resolveResourceMembers(
  resource: string,
  source?: ReturnType<typeof resolveRegistrySource>,
): Promise<string[]> {
  if (!resource.includes('/templates/')) return [resource];
  if (!source) throw new Error('A registry source is required to inspect this template.');

  const loaded = await readRegistrySourceResource(source, resource);
  return loaded.resources.map((entry) => resourceKey(entry.resource));
}

async function promptInstalledResource(
  records: InstallationRecord[],
  source?: ReturnType<typeof resolveRegistrySource>,
): Promise<InstalledResourceChoice | undefined> {
  const choices: InstalledResourceChoice[] = [...new Set(records.map((record) => record.resource))]
    .sort()
    .map((resource) => ({ resource, resources: [resource] }));

  if (source) {
    const index = await readRegistrySourceIndex(source);
    const templates = await Promise.all(
      index.resources
        .filter((resource) => resource.type === 'templates' && resource.lifecycleStatus === 'active')
        .map(async (resource) => {
          const id = resourceKey(resource);
          const resources = await resolveResourceMembers(id, source);
          const installed = records.some((record) =>
            resources.every((member) =>
              records.some(
                (candidate) =>
                  candidate.resource === member &&
                  candidate.harness === record.harness &&
                  candidate.scope === record.scope,
              ),
            ),
          );

          return installed ? { resource: id, resources } : undefined;
        }),
    );

    choices.push(...templates.filter((choice): choice is InstalledResourceChoice => choice !== undefined));
  }

  choices.sort((left, right) => left.resource.localeCompare(right.resource));

  if (choices.length === 0) {
    throw new Error('No installed resources found. Install a resource first.');
  }

  const answer = await select({
    message: 'Which installed resource do you want to use?',
    options: choices.map((choice) => ({
      value: choice.resource,
      label: choice.resource,
      hint: choice.resources.length > 1
        ? `${choice.resources.length} component resources`
        : records
          .filter((record) => record.resource === choice.resource)
          .map((record) => `${record.harness}/${record.scope} · v${record.version}`)
        .join(', '),
    })),
  });

  if (isCancel(answer)) return cancelled('Operation cancelled.');
  return choices.find((choice) => choice.resource === answer);
}

async function promptInstalledScope(
  records: InstallationRecord[],
  resources: string[],
): Promise<InstallScope | undefined> {
  const scopes = [...new Set(
    records
      .filter((record) => resources.includes(record.resource))
      .map((record) => record.scope),
  )];

  if (scopes.length === 1) return scopes[0];

  const answer = await select({
    message: 'Which installation scope should be changed?',
    options: scopes.map((scope) => ({
      value: scope,
      label: scope === 'project' ? 'This project' : 'All projects',
    })),
  });

  return isCancel(answer) ? cancelled('Operation cancelled.') : answer;
}

async function promptInstalledHarnesses(
  records: InstallationRecord[],
  resources: string[],
  scope: InstallScope,
): Promise<Harness[] | undefined> {
  const available = harnessOptions
    .map((option) => option.value)
    .filter((harness) =>
      resources.every((resource) =>
        records.some(
          (record) =>
            record.resource === resource &&
            record.harness === harness &&
            record.scope === scope,
        ),
      ),
    );
  const answer = await autocompleteMultiselect({
    message: 'Which installed harnesses should be changed?',
    placeholder: 'Type to filter harnesses',
    options: harnessOptions.filter((option) => available.includes(option.value)),
    initialValues: available,
    required: true,
  });

  return isCancel(answer) ? cancelled('Operation cancelled.') : answer;
}

function isForceableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Use --force|modified|ownership hashes/u.test(message);
}

async function withInteractiveForce<T>(
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

const create = defineCommand({
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
      options: ['skills', 'agents', 'rules', 'templates'],
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
      console.log(`Entry file: ${join(outputDirectory, entryFiles[typeValue])}`);
      console.log(
        `Next: aid submit "${outputValue}" --id ${id} --version 1.0.0 --description ${JSON.stringify(descriptionValue)}`,
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
        interactive ? await promptRequiredText('What version are you publishing?', '1.0.0') : undefined
      );
      if (!version) throw new Error('Version is required. Pass `--version` in a script.');

      const description = args.description.trim() || (
        interactive ? await promptRequiredText('What does this resource do?', 'Short description') : undefined
      );
      if (!description) throw new Error('Description is required. Pass `--description` in a script.');

      const source = getRegistrySource(args.index, args.repository, args.base);
      const result = await submitResource({
        ...(source.type === 'local' ? { indexPath: source.indexPath } : {}),
        sourceDirectory,
        resourceId,
        version,
        description,
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
      default: '',
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
      const interactiveTerminal = isInteractiveTerminal();
      const source = getRegistrySource(args.index, args.repository, args.base);
      const resourceArgument = args.resource.trim();
      const resource = resourceArgument || (
        interactiveTerminal ? await promptResource(source) : undefined
      );
      if (!resource) throw new Error('Resource ID is required. Pass it as the positional argument.');
      const scope = args.scope ?? (interactiveTerminal ? await promptScope() : undefined);
      if (!scope) throw new Error('Installation scope is required. Pass `--scope project|global`.');
      const explicitHarnesses = hasHarnessArgument(rawArgs);
      const harnesses = explicitHarnesses
        ? parseHarnesses(args.harness, rawArgs)
        : interactiveTerminal
          ? await promptHarnesses()
          : parseHarnesses(args.harness, rawArgs);

      if (!harnesses) throw new Error('Select at least one harness.');

      const loaded = await readRegistrySourceResource(source, resource, args.version);
      const result = loaded.resource;

      const resources = loaded.resources;

      for (const resource of [result, ...resources]) {
        if (resource.resource.reviewStatus === 'unreviewed') {
          console.warn(
            `Warning: ${resourceKey(resource.resource)}@${resource.version} has not been reviewed.`,
          );
        }
      }

      const manifestPath = getInstallManifestPath(scope);
      const interactive = interactiveTerminal && (!resourceArgument || !args.scope || !explicitHarnesses);

      const installationsByHarness = await withInteractiveForce(
        interactive,
        args.force ?? false,
        async (force) => {
          const resultByHarness: Record<string, InstallResult[]> = {};

          for (const harness of harnesses) {
            const installer = getHarnessAdapter(harness);
            const installations = await installer.install(resources, { scope, force });
            const records = createInstallationRecords(resources, installations, scope, harness);
            await saveInstallationRecords(manifestPath, records, { scope, force });
            resultByHarness[harness] = installations;
          }

          return resultByHarness;
        },
      );

      if (!installationsByHarness) return;

      for (const harness of harnesses) {
        const installations = installationsByHarness[harness];

        if (!installations) continue;

        for (const [index, installedResource] of resources.entries()) {
          const installation = installations[index];

          if (!installation) {
            throw new Error(`Installation result missing for ${resourceKey(installedResource.resource)}.`);
          }

          console.log(
            `Location: ${installation.destination} (${resourceKey(installedResource.resource)}@${installedResource.version}, ${harness})`,
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
      default: '',
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
      const interactiveTerminal = isInteractiveTerminal();
      const resourceArgument = args.resource.trim();
      const explicitHarnesses = hasHarnessArgument(rawArgs);
      const source = getRegistrySource(args.index, args.repository, args.base);
      const installedRecords = interactiveTerminal && (!resourceArgument || !args.scope || !explicitHarnesses)
        ? await readInstalledRecords()
        : [];
      const choice = resourceArgument
        ? {
            resource: resourceArgument,
            resources: await resolveResourceMembers(resourceArgument, source),
          }
        : (
            interactiveTerminal
              ? await promptInstalledResource(installedRecords, source)
              : undefined
          );
      if (!choice) throw new Error('Resource ID is required. Pass it as the positional argument.');
      const resource = choice.resource;
      const resourceIds = choice.resources;
      const scope = args.scope ?? (
        interactiveTerminal ? await promptInstalledScope(installedRecords, resourceIds) : undefined
      );
      if (!scope) throw new Error('Installation scope is required. Pass `--scope project|global`.');
      const harnesses = explicitHarnesses
        ? parseHarnesses(args.harness, rawArgs)
        : interactiveTerminal
          ? await promptInstalledHarnesses(installedRecords, resourceIds, scope)
          : parseHarnesses(args.harness, rawArgs);

      if (!harnesses) throw new Error('Select at least one harness.');

      const interactive = interactiveTerminal && (!resourceArgument || !args.scope || !explicitHarnesses);
      const updatedHarnesses = await withInteractiveForce(
        interactive,
        args.force ?? false,
        async (force) => {
          const manifestPath = getInstallManifestPath(scope);
          const manifest = await readInstallationManifest(manifestPath);
          const loaded = await readRegistrySourceResource(source, resource);
          const existing = harnesses.map((harness) =>
            loaded.resources.map((entry) =>
              manifest.installations.find(
                (record) =>
                  record.resource === resourceKey(entry.resource) &&
                  record.harness === harness &&
                  record.scope === scope,
              ),
            ),
          );

          if (existing.some((records) => records.some((record) => !record))) {
            const missing = harnesses.filter((_, index) =>
              existing[index]?.some((record) => !record),
            );
            throw new Error(
              `${resource} is not installed for ${missing.join(', ')} in the ${scope} scope.`,
            );
          }

          const existingRecords = existing.flatMap((records) =>
            records.filter(
              (record): record is NonNullable<typeof record> => record !== undefined,
            ),
          );
          for (const record of existingRecords) {
            await assertInstallationFilesUnchanged(record, force);
          }

          for (const entry of [loaded.resource, ...loaded.resources]) {
            if (entry.resource.reviewStatus === 'unreviewed') {
              console.warn(
                `Warning: ${resourceKey(entry.resource)}@${entry.version} has not been reviewed.`,
              );
            }
          }

          const changed: Harness[] = [];

          for (const [index, harness] of harnesses.entries()) {
            const installedRecords = existing[index] ?? [];

            if (loaded.resources.every((entry, resourceIndex) =>
              entry.version === installedRecords[resourceIndex]?.version,
            )) {
              console.log(`${resource} is already at the latest version for ${harness} (${loaded.resource.version}).`);
              continue;
            }

            const installer = getHarnessAdapter(harness);
            const installations = await installer.install(loaded.resources, {
              scope,
              force: true,
            });
            const nextRecords = createInstallationRecords(loaded.resources, installations, scope, harness);
            await saveInstallationRecords(manifestPath, nextRecords, { scope, force });
            changed.push(harness);
          }

          return { changed, manifestPath, version: loaded.resource.version };
        },
      );

      if (!updatedHarnesses) return;
      if (updatedHarnesses.changed.length > 0) {
        console.log(
          `Updated ${resource} to ${updatedHarnesses.version} for ${updatedHarnesses.changed.join(', ')}.`,
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
      default: '',
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
      description: 'Installation scope to change',
    },
    index: {
      type: 'string',
      alias: 'i',
      description: 'Local registry index path for template resources',
    },
    repository: {
      type: 'string',
      description: 'Git repository URL for template resources',
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
      const interactiveTerminal = isInteractiveTerminal();
      const resourceArgument = args.resource.trim();
      const explicitHarnesses = hasHarnessArgument(rawArgs);
      const source = (() => {
        try {
          return getRegistrySource(args.index, args.repository, args.base);
        } catch {
          return undefined;
        }
      })();
      const installedRecords = interactiveTerminal && (!resourceArgument || !args.scope || !explicitHarnesses)
        ? await readInstalledRecords()
        : [];
      const choice = resourceArgument
        ? {
            resource: resourceArgument,
            resources: await resolveResourceMembers(resourceArgument, source),
          }
        : (
            interactiveTerminal
              ? await promptInstalledResource(installedRecords, source)
              : undefined
          );
      if (!choice) throw new Error('Resource ID is required. Pass it as the positional argument.');
      const resource = choice.resource;
      const resourceIds = choice.resources;
      const scope = args.scope ?? (
        interactiveTerminal ? await promptInstalledScope(installedRecords, resourceIds) : undefined
      );
      if (!scope) throw new Error('Installation scope is required. Pass `--scope project|global`.');
      const harnesses = explicitHarnesses
        ? parseHarnesses(args.harness, rawArgs)
        : interactiveTerminal
          ? await promptInstalledHarnesses(installedRecords, resourceIds, scope)
          : parseHarnesses(args.harness, rawArgs);

      if (!harnesses) throw new Error('Select at least one harness.');

      const interactive = interactiveTerminal && (!resourceArgument || !args.scope || !explicitHarnesses);
      const result = await withInteractiveForce(
        interactive,
        args.force ?? false,
        async (force) => {
          const manifestPath = getInstallManifestPath(scope);
          const manifest = await readInstallationManifest(manifestPath);
          const existing = harnesses.map((harness) =>
            resourceIds.map((resourceId) =>
              manifest.installations.find(
                (record) =>
                  record.resource === resourceId &&
                  record.harness === harness &&
                  record.scope === scope,
              ),
            ),
          );

          if (existing.some((records) => records.some((record) => !record))) {
            const missing = harnesses.filter((_, index) =>
              existing[index]?.some((record) => !record),
            );
            throw new Error(
              `${resource} is not installed for ${missing.join(', ')} in the ${scope} scope.`,
            );
          }

          const existingRecords = existing.flatMap((records) =>
            records.filter(
              (record): record is NonNullable<typeof record> => record !== undefined,
            ),
          );
          for (const record of existingRecords) {
            await assertInstallationFilesUnchanged(record, force);
          }
          for (const record of existingRecords) {
            await uninstallInstallation(record, { scope, force });
            await removeInstallationRecord(manifestPath, record);
          }

          return manifestPath;
        },
      );

      if (!result) return;
      console.log(`Uninstalled ${resource} for ${harnesses.join(', ')}.`);
      console.log(`Updated: ${result}`);
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
    const nonInteractive = args['non-interactive'] ?? !isInteractiveTerminal();
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
        if (nonInteractive) {
          const index = await readRemoteRegistryIndex({ repositoryUrl: repository });
          console.log(`Connected. Found ${index.resources.length} resource(s).`);
        } else {
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

async function runInteractiveMain(): Promise<void> {
  intro('AI Directory');

  const answer = await select({
    message: 'What do you want to do?',
    options: [
      { value: 'install', label: 'Install a resource' },
      { value: 'list', label: 'Browse resources' },
      { value: 'show', label: 'View resource details' },
      { value: 'create', label: 'Create a resource' },
      { value: 'submit', label: 'Submit a resource' },
      { value: 'update', label: 'Update an installed resource' },
      { value: 'uninstall', label: 'Uninstall a resource' },
      { value: 'installed', label: 'List installed resources' },
      { value: 'setup', label: 'Configure the registry' },
      { value: 'doctor', label: 'Check the setup' },
      { value: 'exit', label: 'Exit' },
    ],
  });

  if (isCancel(answer) || answer === 'exit') {
    cancel('Operation cancelled.');
    return;
  }

  switch (answer) {
    case 'install':
      await runCommand(install, { rawArgs: [] });
      break;
    case 'list':
      await runCommand(list, { rawArgs: [] });
      break;
    case 'show':
      await runCommand(show, { rawArgs: [] });
      break;
    case 'create':
      await runCommand(create, { rawArgs: [] });
      break;
    case 'submit':
      await runCommand(submit, { rawArgs: [] });
      break;
    case 'update':
      await runCommand(update, { rawArgs: [] });
      break;
    case 'uninstall':
      await runCommand(uninstall, { rawArgs: [] });
      break;
    case 'installed':
      await runCommand(installed, { rawArgs: [] });
      break;
    case 'setup':
      await runCommand(setup, { rawArgs: [] });
      break;
    case 'doctor':
      await runCommand(doctor, { rawArgs: [] });
      break;
  }
}

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
    create,
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
  async run({ rawArgs }) {
    if (rawArgs.length === 0) {
      if (isInteractiveTerminal()) await runInteractiveMain();
      else await showUsage(main);
    }
  },
});

runMain(main);
