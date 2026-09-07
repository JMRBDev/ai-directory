import { cancel, intro, isCancel, outro, select, spinner, text, type TextOptions } from '@clack/prompts';
import { defineCommand } from 'citty';
import {
  addRegistryEntry,
  normalizeRegistryId,
  readRegistryEntries,
  type ConfigScope,
} from '@ai-directory/config';
import { readRemoteRegistryIndex } from '@ai-directory/registry';
import { isInteractiveTerminal, reportError } from '../helpers';

export const setup = defineCommand({
  meta: {
    name: 'setup',
    description: 'Connect AI Directory to a registry Git repository',
  },
  args: {
    repository: {
      type: 'string',
      description: 'Registry Git URL; skips the repository prompt',
    },
    id: {
      type: 'string',
      description: 'Registry id, for example company; defaults to default',
    },
    branch: {
      type: 'string',
      description: 'Registry branch; defaults to main',
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
    const existing = readRegistryEntries()[0];

    try {
      if (!nonInteractive) intro('AI Directory setup');

      let repository = args.repository?.trim() || existing?.url;
      let registryId = args.id?.trim() || existing?.id || 'default';

      if (!args.repository && !nonInteractive) {
        const options: TextOptions = {
          message: 'What is the registry Git URL?',
          placeholder: 'git@github.com:you/ai-directory-registry.git',
          validate(value) {
            if (!value?.trim()) return 'A registry Git URL is required.';
          },
        };
        if (existing?.url) options.initialValue = existing.url;

        const answer = await text(options);

        if (isCancel(answer)) {
          cancel('Setup cancelled.');
          return;
        }

        repository = answer.trim();
      }

      if (!args.id && !nonInteractive) {
        const answer = await text({
          message: 'What id should this registry use?',
          placeholder: 'company',
          initialValue: registryId,
          validate(value) {
            if (!value?.trim()) return 'A registry id is required.';
            try {
              normalizeRegistryId(value);
            } catch {
              return 'Use a lowercase slug, for example company.';
            }
          },
        });
        if (isCancel(answer)) {
          cancel('Setup cancelled.');
          return;
        }
        registryId = answer.trim();
      }

      if (!repository) {
        throw new Error(
          'No registry repository configured. Pass --repository or run setup interactively.',
        );
      }
      registryId = normalizeRegistryId(registryId);

      let scope: ConfigScope;

      if (args.scope) {
        // SAFETY: citty validates enum args against the ['user', 'project'] options.
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

        // SAFETY: select() only returns one of the configured ['user', 'project'] values.
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

      const branch = args.branch?.trim() || undefined;
      const entry = branch ? { id: registryId, url: repository, branch } : { id: registryId, url: repository };
      const { path } = await addRegistryEntry(entry, scope);

      if (!nonInteractive) {
        outro(`Saved registry ${registryId} in the ${scope} config.`);
      } else {
        console.log(`Saved registry ${registryId} in the ${scope} config: ${path}`);
      }
    } catch (error) {
      reportError(error);
    }
  },
});
