import { defineCommand } from 'citty';
import {
  clearConfigFile,
  getConfigPath,
  getRepositorySetting,
  readConfigFile,
  writeConfigFile,
  type ConfigScope,
} from '@ai-directory/config';

function assertRepositoryKey(key: string): void {
  if (key !== 'repository') {
    throw new Error('Unknown config key: repository is the only supported key.');
  }
}

export const configList = defineCommand({
  meta: {
    name: 'list',
    description: 'List available configuration options',
  },
  run() {
    console.log('Available configuration options:');
    console.log('\nrepository');
    console.log('  Git URL of the production resource registry.');
    console.log('\nUse `aid config get <key>` to inspect the effective value.');
  },
});

export const configGet = defineCommand({
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
    assertRepositoryKey(args.key);

    if (args.scope) {
      // SAFETY: citty validates enum args against the ['user', 'project'] options.
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

export const configSet = defineCommand({
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
    assertRepositoryKey(args.key);
    const value = args.value.trim();

    if (!value) throw new Error('Repository URL cannot be empty.');

    // SAFETY: citty validates enum args against the ['user', 'project'] options.
    const scope = args.scope as ConfigScope;
    const path = getConfigPath(scope);
    const current = readConfigFile(path);

    await writeConfigFile(path, { ...current, repository: value });
    console.log(`Saved repository in the ${scope} config: ${path}`);
  },
});

export const configClear = defineCommand({
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
    assertRepositoryKey(args.key);

    // SAFETY: citty validates enum args against the ['user', 'project'] options.
    const scope = args.scope as ConfigScope;
    const path = getConfigPath(scope);
    await clearConfigFile(path);
    console.log(`Cleared repository from the ${scope} config: ${path}`);
  },
});

export const configPath = defineCommand({
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
    // SAFETY: citty validates enum args against the ['user', 'project'] options.
    console.log(getConfigPath(args.scope as ConfigScope));
  },
});
