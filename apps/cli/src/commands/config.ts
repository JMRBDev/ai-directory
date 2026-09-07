import { defineCommand } from 'citty';
import {
  addResourceDirectory,
  clearConfigFile,
  getConfigPath,
  getRepositorySetting,
  normalizeResourceDirectoryPath,
  pathExists,
  readConfigFile,
  readResourceDirectories,
  removeResourceDirectory,
  writeConfigFile,
  type ConfigScope,
} from '@ai-directory/config';

function assertRepositoryKey(key: string): void {
  if (key !== 'repository' && key !== 'resource-directories') {
    throw new Error('Unknown config key: repository and resource-directories are supported.');
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
    console.log('\nresource-directories');
    console.log('  Extra folders scanned for skills, rules, agents, plugins, and tools.');
    console.log('\nUse `aid config get <key>` to inspect the effective value.');
  },
});

export const configGet = defineCommand({
  meta: {
    name: 'get',
    description: 'Show a configuration value',
  },
  args: {
    key: {
      type: 'positional',
      required: true,
      description: 'Configuration key: repository, resource-directories',
    },
    scope: {
      type: 'enum',
      options: ['user', 'project'],
      description: 'Read a stored value from one config scope',
    },
  },
  run({ args }) {
    assertRepositoryKey(args.key);

    if (args.key === 'resource-directories') {
      const directories = readResourceDirectories();
      if (args.scope) {
        const scope = args.scope as ConfigScope;
        const scoped = directories.filter((entry) => entry.scope === scope);
        console.log(scoped.length > 0 ? JSON.stringify(scoped, null, 2) : `No resource directories in the ${scope} config.`);
        return;
      }
      console.log(directories.length > 0 ? JSON.stringify(directories, null, 2) : 'No resource directories configured.');
      return;
    }

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
    description: 'Set a configuration value',
  },
  args: {
    key: {
      type: 'positional',
      required: true,
      description: 'Configuration key: repository, resource-directories',
    },
    value: {
      type: 'positional',
      required: true,
      description: 'Repository Git URL or resource directory path',
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
    if (args.key === 'resource-directories') {
      const normalized = normalizeResourceDirectoryPath(args.value.trim());
      if (!(await pathExists(normalized))) {
        throw new Error(`Directory does not exist: ${normalized}.`);
      }
      const { path } = await addResourceDirectory({ path: normalized }, scope);
      console.log(`Saved resource directory in the ${scope} config: ${path}`);
      return;
    }

    const value = args.value.trim();
    if (!value) throw new Error('Repository URL cannot be empty.');

    const path = getConfigPath(scope);
    const current = readConfigFile(path);

    await writeConfigFile(path, { ...current, repository: value });
    console.log(`Saved repository in the ${scope} config: ${path}`);
  },
});

export const configClear = defineCommand({
  meta: {
    name: 'clear',
    description: 'Remove a configuration value',
  },
  args: {
    key: {
      type: 'positional',
      required: true,
      description: 'Configuration key: repository, resource-directories',
    },
    value: {
      type: 'positional',
      required: false,
      description: 'Resource directory path (required for resource-directories)',
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
    if (args.key === 'resource-directories') {
      const value = typeof args.value === 'string' ? args.value.trim() : '';
      if (!value) throw new Error('Pass the directory path to remove.');
      const normalized = normalizeResourceDirectoryPath(value);
      const result = await removeResourceDirectory(normalized, scope);
      if (!result.removed) throw new Error(`Resource directory is not configured: ${normalized}.`);
      console.log(`Removed resource directory from the ${scope} config.`);
      return;
    }

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
