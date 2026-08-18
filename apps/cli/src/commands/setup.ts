import { cancel, intro, isCancel, outro, select, spinner, text, type TextOptions } from '@clack/prompts';
import { defineCommand } from 'citty';
import {
  getConfigPath,
  getRepositorySetting,
  readConfigFile,
  writeConfigFile,
  type ConfigScope,
} from '@ai-directory/config';
import type { HarnessDetection } from '@ai-directory/installers';
import { detectHarnesses } from '@ai-directory/installers';
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
        const options: TextOptions = {
          message: 'What is the registry Git URL?',
          placeholder: 'git@github.com:company/ai-directory-registry.git',
          validate(value) {
            if (!value?.trim()) return 'A registry Git URL is required.';
          },
        };
        if (existing.value) options.initialValue = existing.value;

        const answer = await text(options);

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

      const path = getConfigPath(scope);
      const current = readConfigFile(path);
      await writeConfigFile(path, { ...current, repository });

      if (!nonInteractive) {
        outro(`Saved the registry repository in the ${scope} config.`);
      } else {
        console.log(`Saved the registry repository in the ${scope} config: ${path}`);
      }
    } catch (error) {
      reportError(error);
    }
  },
});

interface RegistryDiagnostics {
  ok: boolean;
  repository: string | null;
  source: string;
  branch: string;
  resourceCount?: number;
  activeCount?: number;
  unreviewedCount?: number;
  harnesses: HarnessDetection[];
  error?: string;
}

export const doctor = defineCommand({
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
    const diagnostics: RegistryDiagnostics = {
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
          ...harness.paths.map((path) => `path=${path}`),
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
