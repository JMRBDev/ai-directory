import { defineCommand } from 'citty';
import {
  addRegistryEntry,
  addResourceDirectory,
  clearConfigFile,
  getConfigPath,
  getRepositorySetting,
  normalizeRegistryId,
  normalizeResourceDirectoryPath,
  pathExists,
  readConfigFile,
  readRegistryEntries,
  readResourceDirectories,
  removeRegistryEntry,
  removeResourceDirectory,
  writeConfigFile,
  type ConfigScope,
} from '@ai-directory/config';

function assertRepositoryKey(key: string): void {
  if (key !== 'repository' && key !== 'resource-directories' && key !== 'registries' && key !== 'registry') {
    throw new Error('Unknown config key: repository, registries, and resource-directories are supported.');
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
    console.log('  Git URL of the first registry (legacy alias for registries).');
    console.log('\nregistries');
    console.log('  Ordered registry list: id, url, branch, scope.');
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
      description: 'Configuration key: repository, registries, resource-directories',
    },
    scope: {
      type: 'enum',
      options: ['user', 'project'],
      description: 'Read a stored value from one config scope',
    },
  },
  run({ args }) {
    assertRepositoryKey(args.key);

    if (args.key === 'registries' || args.key === 'registry') {
      const entries = readRegistryEntries().filter((entry) =>
        !args.scope || entry.scope === (args.scope as ConfigScope),
      );
      console.log(entries.length > 0 ? JSON.stringify(entries, null, 2) : 'No registries configured.');
      return;
    }

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
      description: 'Configuration key: repository, registries, resource-directories',
    },
    value: {
      type: 'positional',
      required: true,
      description: 'Repository Git URL, registry URL, or resource directory path',
    },
    id: {
      type: 'string',
      description: 'Registry id for registries, for example company',
    },
    branch: {
      type: 'string',
      description: 'Registry branch for registries; defaults to main',
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
    if (args.key === 'registries' || args.key === 'registry') {
      const url = args.value.trim();
      if (!url) throw new Error('Registry URL cannot be empty.');
      const id = normalizeRegistryId(typeof args.id === 'string' && args.id.trim() ? args.id : 'default');
      const branch = typeof args.branch === 'string' && args.branch.trim() ? args.branch.trim() : undefined;
      const entry = branch ? { id, url, branch } : { id, url };
      const { path } = await addRegistryEntry(entry, scope);
      console.log(`Saved registry ${id} in the ${scope} config: ${path}`);
      return;
    }
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
      description: 'Configuration key: repository, registries, resource-directories',
    },
    value: {
      type: 'positional',
      required: false,
      description: 'Registry id, directory path, or empty for repository',
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
    if (args.key === 'registries' || args.key === 'registry') {
      const value = typeof args.value === 'string' ? args.value.trim() : '';
      if (!value) throw new Error('Pass the registry id to remove.');
      const result = await removeRegistryEntry(normalizeRegistryId(value), scope);
      if (!result.removed) throw new Error(`Registry is not configured: ${value}.`);
      console.log(`Removed registry ${value} from the ${scope} config.`);
      return;
    }
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
