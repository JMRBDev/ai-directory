import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import envPaths from 'env-paths';

export type ConfigScope = 'user' | 'project';

export const DEFAULT_API_HOST = '127.0.0.1';
export const DEFAULT_API_PORT = 4317;
export const DEFAULT_API_URL = `http://${DEFAULT_API_HOST}:${DEFAULT_API_PORT}`;

export type AiDirectoryConfig = {
  repository?: string;
};

export const CONFIG_OPTIONS = [
  {
    key: 'repository',
    description: 'Git URL of the production resource registry.',
  },
] as const;

export type ConfigKey = (typeof CONFIG_OPTIONS)[number]['key'];

export type RepositorySetting = {
  value?: string;
  source: 'argument' | 'environment' | 'project' | 'user' | 'none';
};

const configFileName = 'config.json';

export function getConfigPath(scope: ConfigScope, cwd = process.cwd()): string {
  if (scope === 'project') return join(cwd, '.ai-directory', configFileName);

  return join(envPaths('ai-directory', { suffix: '' }).config, configFileName);
}

export function getInstallManifestPath(
  scope: 'project' | 'global',
  cwd = process.cwd(),
  homeDirectory?: string,
): string {
  if (scope === 'project') return join(cwd, '.ai-directory', 'installed.json');

  const dataDirectory = homeDirectory
    ? join(resolve(homeDirectory), '.local', 'share', 'ai-directory')
    : envPaths('ai-directory', { suffix: '' }).data;

  return join(dataDirectory, 'installed.json');
}

export function findWorkspaceRoot(startDirectory: string): string | null {
  let directory = resolve(startDirectory);

  while (true) {
    if (existsSync(join(directory, 'pnpm-workspace.yaml'))) return directory;

    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

export function readConfigFile(path: string): AiDirectoryConfig {
  if (!existsSync(path)) return {};

  let data: unknown;

  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`AI Directory config is not valid JSON: ${path}`, { cause: error });
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(`AI Directory config must be a JSON object: ${path}`);
  }

  const repository = 'repository' in data ? data.repository : undefined;

  if (repository !== undefined && (typeof repository !== 'string' || !repository.trim())) {
    throw new Error(`AI Directory config repository must be a non-empty string: ${path}`);
  }

  return repository === undefined ? {} : { repository: repository.trim() };
}

export async function writeConfigFile(path: string, config: AiDirectoryConfig): Promise<void> {
  await mkdir(dirname(path), { recursive: true });

  const temporaryPath = `${path}.tmp-${process.pid}`;

  try {
    await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function clearConfigFile(path: string): Promise<void> {
  await rm(path, { force: true });
}

export function getRepositorySetting(
  explicitRepository?: string,
  cwd = process.cwd(),
): RepositorySetting {
  if (explicitRepository?.trim()) {
    return { value: explicitRepository.trim(), source: 'argument' };
  }

  if (process.env.AI_DIRECTORY_REGISTRY_REPOSITORY?.trim()) {
    return {
      value: process.env.AI_DIRECTORY_REGISTRY_REPOSITORY.trim(),
      source: 'environment',
    };
  }

  const projectRepository = readConfigFile(getConfigPath('project', cwd)).repository;

  if (projectRepository) return { value: projectRepository, source: 'project' };

  const userRepository = readConfigFile(getConfigPath('user', cwd)).repository;

  if (userRepository) return { value: userRepository, source: 'user' };

  return { source: 'none' };
}

export function resolveRepository(
  explicitRepository?: string,
  cwd = process.cwd(),
): string | undefined {
  return getRepositorySetting(explicitRepository, cwd).value;
}
