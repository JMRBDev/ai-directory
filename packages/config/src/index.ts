import { existsSync, readFileSync } from 'node:fs';
import { access, lstat, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import envPaths from 'env-paths';

export type ConfigScope = 'user' | 'project';

export const DEFAULT_API_HOST = '127.0.0.1';
export const DEFAULT_API_PORT = 4317;
export const DEFAULT_API_URL = `http://${DEFAULT_API_HOST}:${DEFAULT_API_PORT}`;

const configSchema = z.object({
  repository: z.string().trim().min(1).optional(),
});

export type AiDirectoryConfig = z.infer<typeof configSchema>;

export type RepositorySetting = {
  value?: string;
  source: 'argument' | 'environment' | 'project' | 'user' | 'none';
};

const configFileName = 'config.json';

export function getConfigPath(scope: ConfigScope, cwd = process.cwd()): string {
  if (scope === 'project') return join(cwd, '.ai-directory', configFileName);

  return join(envPaths('ai-directory', { suffix: '' }).config, configFileName);
}

export function getInstallManifestPath(homeDirectory?: string): string {
  const dataDirectory = homeDirectory
    ? join(resolve(homeDirectory), '.local', 'share', 'ai-directory')
    : envPaths('ai-directory', { suffix: '' }).data;

  return join(dataDirectory, 'installed.json');
}

export function getProjectInstallManifestPath(cwd = process.cwd()): string {
  return join(cwd, '.ai-directory', 'installed.json');
}

export function getScopeInstallManifestPath(
  scope: ConfigScope,
  cwd = process.cwd(),
  homeDirectory?: string,
): string {
  return scope === 'project'
    ? getProjectInstallManifestPath(cwd)
    : getInstallManifestPath(homeDirectory);
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

export function resolveConfigCwd(): string {
  return process.env.AI_DIRECTORY_CONFIG_CWD ?? findWorkspaceRoot(process.cwd()) ?? process.cwd();
}

export function readConfigFile(path: string): AiDirectoryConfig {
  if (!existsSync(path)) return {};

  let data: unknown;

  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`AI Directory config is not valid JSON: ${path}`, { cause: error });
  }

  const result = configSchema.safeParse(data);

  if (!result.success) {
    const issue = result.error.issues[0];
    if (issue?.path[0] === 'repository') {
      throw new Error(`AI Directory config repository must be a non-empty string: ${path}`);
    }
    throw new Error(`AI Directory config must be a JSON object: ${path}`);
  }

  return result.data;
}

export async function writeConfigFile(path: string, config: AiDirectoryConfig): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(config, null, 2)}\n`);
}

export async function writeFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });

  const temporaryPath = `${path}.tmp-${process.pid}`;

  try {
    await writeFile(temporaryPath, content, 'utf8');
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function clearConfigFile(path: string): Promise<void> {
  await rm(path, { force: true });
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }

    throw error;
  }
}

export function isMissingPathError(cause: unknown): boolean {
  if (!(cause instanceof Object)) return false;
  if ('code' in cause && cause.code === 'ENOENT') return true;
  if ('cause' in cause) return isMissingPathError(cause.cause);

  return false;
}

export function isPathExistsError(cause: unknown): boolean {
  return (
    cause instanceof Object &&
    'code' in cause &&
    cause.code === 'EEXIST'
  );
}

export async function listFilesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true });
  const files: string[] = [];
  for (const name of entries) {
    const stats = await lstat(join(root, name));
    if (stats.isFile()) files.push(join(root, name));
  }
  return files.sort();
}

export function configuredPath(
  environment: NodeJS.ProcessEnv,
  key: string,
): string | undefined {
  const value = environment[key]?.trim();
  return value ? resolve(value) : undefined;
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
