import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { getRepositorySetting } from '@ai-directory/config';
import {
  resolveRegistrySource,
  type RegistrySource,
  type RegistrySourceOptions,
} from '@ai-directory/registry';
import type { ServerOptions } from './types.js';

const execFileAsync = promisify(execFile);

export function configResponse(cwd: string) {
  const setting = getRepositorySetting(undefined, cwd);

  return {
    repository: setting.value ?? null,
    source: setting.source,
  };
}

export function registrySource(options: ServerOptions, cwd: string): RegistrySource {
  const configuredIndex = options.registryIndexPath ?? process.env.AI_DIRECTORY_REGISTRY_INDEX;
  const indexPath = configuredIndex?.trim()
    ? resolve(cwd, configuredIndex.trim())
    : undefined;
  const repositoryValue = getRepositorySetting(undefined, cwd).value;
  const sourceOptions: RegistrySourceOptions = {};
  if (indexPath) sourceOptions.indexPath = indexPath;
  if (repositoryValue) sourceOptions.repositoryUrl = repositoryValue;

  return resolveRegistrySource(sourceOptions);
}

export async function githubUsername(options: ServerOptions, cwd: string): Promise<string> {
  const result = options.commandRunner
    ? await options.commandRunner('gh', ['api', 'user', '--jq', '.login'], cwd)
    : await execFileAsync('gh', ['api', 'user', '--jq', '.login'], { cwd, encoding: 'utf8' });
  const username = result.stdout.trim().toLowerCase();

  if (!/^[a-z0-9-]+$/.test(username)) {
    throw new Error('GitHub CLI did not return a valid username.');
  }

  return username;
}
