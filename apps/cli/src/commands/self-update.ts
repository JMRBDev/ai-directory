import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { confirm, isCancel } from '@clack/prompts';
import { defineCommand } from 'citty';
import {
  mkdir as fsMkdir,
  readFile as fsReadFile,
  rename as fsRename,
  rm as fsRemove,
  writeFile as fsWriteFile,
  chmod as fsChmod,
} from 'node:fs/promises';
import { getAiDirectoryDataDirectory } from '@ai-directory/config';
import { isInteractiveTerminal, reportError } from '../helpers';
import { version } from '../version';
import {
  checkForUpdate,
  downloadAndStage,
  swapIn,
  type UpdateEnvironment,
} from '../self-update/updater';

const execFileAsync = promisify(execFile);

export const selfUpdate = defineCommand({
  meta: {
    name: 'self-update',
    description: 'Update the aid binary to the latest GitHub release',
  },
  args: {
    'dry-run': {
      type: 'boolean',
      alias: 'n',
      description: 'Check for an update without downloading or swapping',
    },
    yes: {
      type: 'boolean',
      alias: 'y',
      description: 'Apply the update without prompting',
    },
    repository: {
      type: 'string',
      description: 'GitHub repository to update from (owner/name)',
    },
  },
  async run({ args }) {
    const interactive = isInteractiveTerminal();
    const dryRun = args['dry-run'] === true;
    const yes = args.yes === true;

    try {
      if (isSourceRun()) {
        console.log('self-update only works on the compiled `aid` binary.');
        console.log('Run it after building: pnpm --filter @ai-directory/cli build && apps/cli/dist/aid self-update');
        return;
      }

      const environment = realUpdateEnvironment(args.repository);
      const check = await checkForUpdate(environment);

      switch (check.status) {
        case 'check-failed':
          throw new Error(check.message);
        case 'no-release':
          console.log('No published release was found for this build channel.');
          return;
        case 'up-to-date':
          console.log(`Already up to date (${check.current}).`);
          return;
        case 'available':
          break;
      }

      // SAFETY: the switch above exhausts the non-available cases.
      const available = check as Extract<typeof check, { status: 'available' }>;
      console.log(`A new version is available: ${available.current} → ${available.latest}`);
      console.log(`Release asset: ${available.assetName}`);

      if (dryRun) {
        console.log('Dry run: no files were downloaded or changed.');
        return;
      }

      if (interactive && !yes) {
        const answer = await confirm({
          message: `Download and install ${available.latest}?`,
          initialValue: true,
        });
        if (isCancel(answer) || !answer) {
          console.log('Update cancelled.');
          return;
        }
      }

      const staged = await downloadAndStage(environment, available.latest, available.assetName, available.digest);
      if (staged.status === 'apply-failed') {
        throw new Error(staged.message);
      }

      // SAFETY: downloadAndStage returns 'staged' on success for every platform.
      const stagedResult = staged as Extract<typeof staged, { status: 'staged' }>;

      const applied = await swapIn(environment, stagedResult.stagedPath, available.latest);
      if (applied.status === 'apply-failed') {
        throw new Error(applied.message);
      }

      if (applied.status === 'applied') {
        console.log(`Updated aid to ${available.latest}. The next command uses the new binary.`);
        return;
      }

      console.log(`Downloaded and verified ${available.latest}.`);
      console.log(`Replace your current binary with: ${stagedResult.stagedPath}`);
      console.log('Windows cannot overwrite a running executable; close aid and move the staged file into place.');
    } catch (error) {
      reportError(error);
    }
  },
});

function realUpdateEnvironment(repositoryOverride: string | undefined): UpdateEnvironment {
  const home = homedir();
  const platform = process.platform === 'darwin' || process.platform === 'linux' || process.platform === 'win32'
    ? process.platform
    : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const repository = repositoryOverride?.trim() || 'JMRBDev/ai-directory';
  const binaryPath = process.execPath;
  const dataDirectory = join(getAiDirectoryDataDirectory(home), 'self-update');

  return {
    platform,
    arch,
    currentVersion: version,
    repository,
    binaryPath,
    dataDirectory,
    gh: (args) => runGh(args),
    readFile: (path) => fsReadFile(path),
    writeFile: (path, contents) => fsWriteFile(path, contents),
    run: (binary, args) => runBinary(binary, args),
    rename: (from, to) => fsRename(from, to),
    chmod: (path, mode) => fsChmod(path, mode),
    remove: (path) => fsRemove(path, { recursive: true, force: true }),
    exists: async (path) => {
      try {
        await fsReadFile(path);
        return true;
      } catch {
        return false;
      }
    },
    mkdir: async (path) => {
      await fsMkdir(path, { recursive: true });
    },
  };
}

async function runGh(args: string[]): Promise<string> {
  const result = await execFileAsync('gh', args, { encoding: 'utf8', maxBuffer: 10_000_000 });
  return result.stdout;
}

async function runBinary(binary: string, args: string[]): Promise<string> {
  const result = await execFileAsync(binary, args, { encoding: 'utf8', timeout: 30_000 });
  return result.stdout;
}

function isSourceRun(): boolean {
  const base = process.execPath.split(/[\\/]/u).at(-1) ?? '';
  return base === 'bun' || base === 'bun.exe';
}

