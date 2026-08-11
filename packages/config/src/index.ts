import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import envPaths from 'env-paths';

export type ConfigScope = 'user' | 'project';

export type AiDirectoryConfig = {
  repository?: string;
};

export type RepositorySetting = {
  value?: string;
  source: 'argument' | 'environment' | 'project' | 'user' | 'none';
};

const configFileName = 'config.json';

export function getConfigPath(scope: ConfigScope, cwd = process.cwd()): string {
  if (scope === 'project') return join(cwd, '.ai-directory', configFileName);

  return join(envPaths('ai-directory', { suffix: '' }).config, configFileName);
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
