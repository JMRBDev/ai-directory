import { confirm, isCancel, select } from '@clack/prompts';
import { defineCommand } from 'citty';
import { harnessSchema, HARNESS_ID_LIST } from '@ai-directory/contracts';
import {
  inspectHarness,
  installHarness,
  inspectHarnesses,
  inspectPiMcpAdapter,
  installPiMcpAdapter,
  uninstallHarness,
  uninstallPiMcpAdapter,
  updateHarness,
  type HarnessStatus,
  type PiMcpAdapterStatus,
} from '@ai-directory/installers';
import { cancelled, isInteractiveTerminal, reportError } from '../helpers';

function parseHarness(value: string) {
  const result = harnessSchema.safeParse(value.trim());

  if (!result.success) {
    throw new Error(`Unknown harness: ${value}. Supported harnesses: ${HARNESS_ID_LIST}.`);
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
        description: `Harness ID: ${HARNESS_ID_LIST}`,
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

export const harnessPiMcpAdapter = defineCommand({
  meta: {
    name: 'pi-mcp-adapter',
    description: 'Manage the Pi MCP adapter extension',
  },
  args: {
    action: {
      type: 'positional',
      default: '',
      description: 'Action: status, install, or uninstall',
    },
    yes: {
      type: 'boolean',
      description: 'Run without a confirmation prompt (scripts and CI)',
    },
  },
  async run({ args }) {
    try {
      const action = args.action.trim() || (
        isInteractiveTerminal() ? await promptAction() : ''
      );
      const options = { cwd: process.cwd() };

      if (action === 'install') {
        await requestAdapterConsent('install', args.yes ?? false);
        const result = await installPiMcpAdapter(options);
        console.log(
          `Installed the Pi MCP adapter${result.version ? ` ${result.version}` : ''}. Restart Pi to activate it.`,
        );
        return;
      }

      if (action === 'uninstall') {
        await requestAdapterConsent('uninstall', args.yes ?? false);
        const result = await uninstallPiMcpAdapter(options);
        console.log(
          `Uninstalled the Pi MCP adapter${result.version ? ` (${result.version})` : ''}. Restart Pi to apply the change.`,
        );
        return;
      }

      const status = await inspectPiMcpAdapter(options);
      printAdapterStatus(status);
    } catch (error) {
      reportError(error);
    }
  },
});

async function promptAction(): Promise<string> {
  const answer = await select({
    message: 'What do you want to do with the Pi MCP adapter?',
    options: [
      { value: 'status', label: 'Check status' },
      { value: 'install', label: 'Install' },
      { value: 'uninstall', label: 'Uninstall' },
    ],
  });
  if (isCancel(answer)) throw cancelled('Operation cancelled.');
  return answer;
}

async function requestAdapterConsent(
  action: 'install' | 'uninstall',
  hasYesFlag: boolean,
): Promise<void> {
  const command = action === 'install'
    ? 'pi install npm:pi-mcp-adapter'
    : 'pi uninstall npm:pi-mcp-adapter';

  if (!isInteractiveTerminal()) {
    if (!hasYesFlag) {
      throw new Error(`Pass --yes to ${action} the Pi MCP adapter in a script. Command: ${command}.`);
    }
    return;
  }

  const answer = await confirm({
    message: `${action === 'install' ? 'Install' : 'Uninstall'} the Pi MCP adapter with ${command}?`,
    initialValue: action === 'install',
  });

  if (isCancel(answer) || !answer) throw cancelled('Operation cancelled.');
}

function printAdapterStatus(status: PiMcpAdapterStatus): void {
  if (status.installed) {
    console.log(`Pi MCP adapter: installed${status.version ? ` v${status.version}` : ''}`);
    console.log(`Uninstall: ${status.uninstallCommand}`);
  } else {
    console.log('Pi MCP adapter: not installed');
    console.log(`Install: ${status.installCommand}`);
    console.log('Pi does not support MCP servers without this community extension.');
  }
}

export const harness = defineCommand({
  meta: {
    name: 'harness',
    description: 'Manage agent harnesses on this machine',
  },
  run({ rawArgs }) {
    if (rawArgs.length === 0) throw new Error('Pass a harness action: list, install, update, uninstall, or pi-mcp-adapter.');
  },
  subCommands: {
    list: harnessList,
    install: managementCommand('install'),
    update: managementCommand('update'),
    uninstall: managementCommand('uninstall'),
    'pi-mcp-adapter': harnessPiMcpAdapter,
  },
});
