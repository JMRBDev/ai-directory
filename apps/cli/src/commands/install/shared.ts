import { dependencyStatusMessage, inspectToolDependencies } from '@ai-directory/installers';
import type { ResourceVersion } from '@ai-directory/registry';
import { promptToolDependencyInstall } from '../../prompts';

export async function ensureToolDependencies(
  resources: ResourceVersion[],
  interactive: boolean,
  allowInstall: boolean,
): Promise<boolean> {
  const statuses = await inspectToolDependencies(resources, { cwd: process.cwd() });
  const missing = statuses.filter((status) => !status.ready);

  if (missing.length === 0) return true;

  const approved = allowInstall || (
    interactive
      ? await promptToolDependencyInstall(missing) ?? false
      : false
  );

  if (!approved) {
    throw new Error(
      'Missing tool dependencies: ' +
      missing.map(dependencyStatusMessage).join('; ') +
      '. Re-run with --install-dependencies to install them using ' +
      [...new Set(missing.flatMap((status) => status.installCommands))].join(' or ') +
      '.',
    );
  }

  return true;
}
