#!/usr/bin/env bun

import { cancel, intro, isCancel, select } from '@clack/prompts';
import { defineCommand, runCommand, runMain, showUsage, type CommandDef } from 'citty';
import { isInteractiveTerminal } from './helpers';
import { check, list, show } from './commands/read';
import { create } from './commands/create';
import { submit, validate } from './commands/publish';
import { install, installed, uninstall, update } from './commands/install';
import { harness } from './commands/harness';
import { doctor, setup } from './commands/setup';
import { configClear, configGet, configList, configPath, configSet } from './commands/config';
import { web } from './commands/web';
import { version } from './version';

const interactiveCommands = {
  install,
  list,
  show,
  create,
  validate,
  submit,
  update,
  uninstall,
  installed,
  setup,
  doctor,
} satisfies Record<string, CommandDef<any>>;

async function runInteractiveMain(): Promise<void> {
  intro('AI Directory');

  const answer = await select({
    message: 'What do you want to do?',
    options: [
      { value: 'install', label: 'Install a resource' },
      { value: 'list', label: 'Browse resources' },
      { value: 'show', label: 'View resource details' },
      { value: 'create', label: 'Create a resource' },
      { value: 'validate', label: 'Validate a resource' },
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

  // SAFETY: every value in interactiveCommands is a CommandDef keyed by answer.
  const command = interactiveCommands[answer] as CommandDef<any> | undefined;
  if (command) await runCommand(command, { rawArgs: [] });
}

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
    version,
    description: 'AI Directory resource registry',
  },
  subCommands: {
    list,
    show,
    check,
    create,
    validate,
    submit,
    install,
    installed,
    update,
    uninstall,
    harness,
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
