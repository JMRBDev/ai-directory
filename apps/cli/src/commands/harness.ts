import { confirm, isCancel } from '@clack/prompts';
import { defineCommand } from 'citty';
import { harnessSchema } from '@ai-directory/contracts';
import {
  inspectHarness,
  installHarness,
  inspectHarnesses,
  uninstallHarness,
  updateHarness,
  type HarnessStatus,
} from '@ai-directory/installers';
import { cancelled, isInteractiveTerminal, reportError } from '../helpers';

const HARNESS_IDS = ['claude-code', 'opencode', 'codex'] as const;

function parseHarness(value: string) {
  const result = harnessSchema.safeParse(value.trim());

  if (!result.success) {
    throw new Error(`Unknown harness: ${value}. Supported harnesses: ${HARNESS_IDS.join(', ')}.`);
  }

  return result.data;
}

async function requestConsent(status: HarnessStatus, action: 'install' | 'update' | 'uninstall', hasYesFlag: boolean): Promise<void> {
  const command = action === 'install'
    ? status.installCommand
    : action === 'update'
      ? status.upgradeCommand
      : status.uninstallCommand;

  if (!isInteractiveTerminal()) {
    if (!hasYesFlag) {
      throw new Error(`Pass --yes to ${action} ${status.displayName} in a script. Command: ${command}.`);
    }
    return;
  }

  const message = action === 'uninstall'
    ? `Remove ${status.displayName} with ${command}? Your ${status.command} configuration directory stays in place.`
    : `${action === 'install' ? 'Install' : 'Update'} ${status.displayName} with ${command}?`;

  const answer = await confirm({
    message,
    initialValue: action !== 'uninstall',
  });

  if (isCancel(answer) || !answer) throw cancelled('Operation cancelled.');
}

function printStatus(status: HarnessStatus): void {
  const version = status.installed ? (status.version ?? 'unknown version') : 'not installed';
  console.log(`${status.displayName}\t${version}\t${status.command}`);
}

export const harnessList = defineCommand({
  meta: {
    name: 'list',
    description: 'List agent harnesses and their installation status',
  },
  args: {
    json: {
      type: 'boolean',
      description: 'Print JSON instead of a table',
    },
  },
  async run({ args }) {
    try {
      const statuses = await inspectHarnesses({ cwd: process.cwd() });

      if (args.json) {
        console.log(JSON.stringify(statuses, null, 2));
        return;
      }

      for (const status of statuses) printStatus(status);
    } catch (error) {
      reportError(error);
    }
  },
});

const actionDescriptions = {
  install: 'Install an agent harness',
  update: 'Update an agent harness',
  uninstall: 'Uninstall an agent harness',
} as const;

function managementCommand(action: keyof typeof actionDescriptions) {
  return defineCommand({
    meta: {
      name: action,
      description: actionDescriptions[action],
    },
    args: {
      harness: {
        type: 'positional',
        default: '',
        description: `Harness ID: ${HARNESS_IDS.join(', ')}`,
      },
      yes: {
        type: 'boolean',
        description: 'Run without a confirmation prompt (scripts and CI)',
      },
    },
    async run({ args }) {
      try {
        const harness = parseHarness(args.harness);
        const status = await inspectHarness(harness, { cwd: process.cwd() });
        await requestConsent(status, action, args.yes ?? false);

        if (action === 'install') {
          const result = await installHarness(harness, { cwd: process.cwd() });
          console.log(`Installed ${status.displayName}${result.version ? ` ${result.version}` : ''} with ${result.command} ${result.args.join(' ')}.`);
        } else if (action === 'update') {
          const result = await updateHarness(harness, { cwd: process.cwd() });
          console.log(`Updated ${status.displayName}${result.version ? ` ${result.version}` : ''} with ${result.command} ${result.args.join(' ')}.`);
        } else {
          const result = await uninstallHarness(harness, { cwd: process.cwd() });
          console.log(`Removed ${status.displayName} with ${result.command} ${result.args.join(' ')}. The ${status.command} configuration directory was left in place.`);
        }
      } catch (error) {
        reportError(error);
      }
    },
  });
}

export const harness = defineCommand({
  meta: {
    name: 'harness',
    description: 'Manage agent harnesses on this machine',
  },
  run({ rawArgs }) {
    if (rawArgs.length === 0) throw new Error('Pass a harness action: list, install, update, or uninstall.');
  },
  subCommands: {
    list: harnessList,
    install: managementCommand('install'),
    update: managementCommand('update'),
    uninstall: managementCommand('uninstall'),
  },
});
