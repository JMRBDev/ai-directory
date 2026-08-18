import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  RESOURCE_ENTRY_FILES,
  resourceIdSchema,
  resourceVersionSchema,
  type ResourceType,
} from '@ai-directory/contracts';
import { resourceTitle } from './helpers';

export type TemplateComponent = {
  id: string;
  version: string;
};

export function parseTemplateComponents(value: string): TemplateComponent[] {
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

  if (type === 'mcp-servers') {
    return [
      '---',
      `name: ${name}`,
      `description: ${quotedDescription}`,
      'transport: http',
      'url: https://example.com/mcp',
      'headers:',
      '  Authorization: "Bearer {env:API_TOKEN}"',
      'env:',
      '  - name: API_TOKEN',
      '    required: true',
      '---',
      '',
      `# ${title}`,
      '',
      description,
      '',
      '## Usage',
      '',
      'Describe how the agent should use this MCP server.',
      '',
    ].join('\n');
  }

  if (type === 'plugins') {
    return `${JSON.stringify(
      {
        name,
        description,
      },
      null,
      2,
    )}\n`;
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

export async function createResourceDirectory(options: {
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
  await mkdir(join(output, dirname(RESOURCE_ENTRY_FILES[options.type])), { recursive: true });
  await writeFile(
    join(output, RESOURCE_ENTRY_FILES[options.type]),
    scaffoldContent(options.type, options.name, options.description, options.components),
    { encoding: 'utf8', flag: 'wx' },
  );

  return output;
}
