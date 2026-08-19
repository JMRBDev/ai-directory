import {
  autocomplete,
  autocompleteMultiselect,
  isCancel,
  select,
  text,
  type AutocompleteMultiSelectOptions,
  type TextOptions,
} from '@clack/prompts';
import { resourceKey } from '@ai-directory/contracts';
import type { InstallationRecord, Harness } from '@ai-directory/installers';
import { installationResourceIds } from '@ai-directory/server-core';
import { readRegistrySourceIndex, type RegistrySource } from '@ai-directory/registry';
import { cancelled } from './helpers';
import { parseTemplateComponents, type TemplateComponent } from './scaffold';

export const resourceTypeOptions = [
  { value: 'skills' as const, label: 'Skill', hint: 'Reusable instructions and workflows' },
  { value: 'agents' as const, label: 'Agent', hint: 'A reusable specialist agent' },
  { value: 'rules' as const, label: 'Rules', hint: 'Guidance applied to coding work' },
  { value: 'mcp-servers' as const, label: 'MCP Server', hint: 'A Model Context Protocol server' },
  { value: 'templates' as const, label: 'Resource pack', hint: 'A pack of existing resources' },
  { value: 'plugins' as const, label: 'Plugin', hint: 'A self-contained bundle of components' },
  { value: 'tools' as const, label: 'Tool', hint: 'A command-line tool with harness adapters' },
];

export const harnessOptions = [
  { value: 'claude-code' as const, label: 'Claude Code', hint: 'Anthropic coding harness' },
  { value: 'opencode' as const, label: 'OpenCode', hint: 'OpenCode agent harness' },
  { value: 'codex' as const, label: 'Codex', hint: 'OpenAI coding agent' },
];

export async function promptRequiredText(
  message: string,
  placeholder: string,
  initialValue?: string,
): Promise<string | undefined> {
  const options: TextOptions = {
    message,
    placeholder,
    validate(value) {
      if (!value?.trim()) return 'This value is required.';
    },
  };
  if (initialValue) options.initialValue = initialValue;

  const answer = await text(options);

  return isCancel(answer) ? cancelled('Operation cancelled.') : answer.trim();
}

export async function promptResourceType() {
  const answer = await select({
    message: 'What kind of resource are you creating?',
    options: resourceTypeOptions,
  });

  return isCancel(answer) ? cancelled('Operation cancelled.') : answer;
}

export async function promptSlug(message: string, placeholder: string): Promise<string | undefined> {
  return promptRequiredText(message, placeholder);
}

export async function promptTemplateComponents(
  source: RegistrySource,
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

export async function promptResource(source: RegistrySource): Promise<string | undefined> {
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

export async function promptHarnesses(initialValues?: Harness[]): Promise<Harness[] | undefined> {
  const options: AutocompleteMultiSelectOptions<Harness> = {
    message: 'Which coding harnesses should be configured?',
    placeholder: 'Type to filter harnesses',
    options: harnessOptions,
    required: true,
  };
  if (initialValues) options.initialValues = initialValues;

  const answer = await autocompleteMultiselect(options);

  return isCancel(answer) ? cancelled('Operation cancelled.') : answer;
}

export type InstalledResourceChoice = {
  resource: string;
  resources: string[];
};

export async function promptInstalledResource(
  records: InstallationRecord[],
  source?: RegistrySource,
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
          const resources = await installationResourceIds(id, source);
          const installed = records.some((record) =>
            resources.every((member) =>
              records.some(
                (candidate) =>
                  candidate.resource === member &&
                  candidate.harness === record.harness,
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
          .map((record) => `${record.harness} · v${record.version}`)
          .join(', '),
    })),
  });

  if (isCancel(answer)) return cancelled('Operation cancelled.');
  return choices.find((choice) => choice.resource === answer);
}

export async function promptInstalledHarnesses(
  records: InstallationRecord[],
  resources: string[],
): Promise<Harness[] | undefined> {
  const available = harnessOptions
    .map((option) => option.value)
    .filter((harness) =>
      resources.every((resource) =>
        records.some(
          (record) =>
            record.resource === resource &&
            record.harness === harness,
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
