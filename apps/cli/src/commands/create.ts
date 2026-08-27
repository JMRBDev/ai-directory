import { join } from 'node:path';
import { defineCommand } from 'citty';
import { RESOURCE_ENTRY_FILES } from '@ai-directory/contracts';
import { getRegistrySource, isInteractiveTerminal, isResourceType, isSlug, reportError } from '../helpers';
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
      options: ['skills', 'agents', 'rules', 'mcp-servers', 'templates', 'plugins', 'tools'],
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
