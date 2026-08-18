#!/usr/bin/env bun

import { cancel, intro, isCancel, select } from '@clack/prompts';
import { defineCommand, runCommand, runMain, showUsage } from 'citty';
import { isInteractiveTerminal } from './helpers';
import { check, list, show } from './commands/read';
import { create, submit, validate } from './commands/create';
import { install, installed, uninstall, update } from './commands/install';
import { doctor, setup } from './commands/setup';
import { configClear, configGet, configList, configPath, configSet } from './commands/config';
import { web } from './commands/web';

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
    case 'validate':
      await runCommand(validate, { rawArgs: [] });
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
    create,
    validate,
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
