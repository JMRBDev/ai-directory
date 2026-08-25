import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { configuredPath, pathExists } from '@ai-directory/config';
import type { Harness } from '@ai-directory/contracts';

export type { Harness } from '@ai-directory/contracts';

export type HarnessPathOptions = {
  cwd?: string;
  homeDirectory?: string;
  environment?: NodeJS.ProcessEnv;
};

export type HarnessLocation = {
  root: string;
  config: string;
  skills: string;
  agents: string;
  rules: string;
  guidance: string;
};

export type HarnessDefinition = {
  harness: Harness;
  displayName: string;
  command: string;
  paths(options: HarnessPathContext): HarnessLocation;
  markers(location: HarnessLocation): string[];
};

export type HarnessDetection = {
  harness: Harness;
  displayName: string;
  command: string;
  executable: string | null;
  configured: boolean;
  paths: string[];
  detected: boolean;
};

export type HarnessPathContext = {
  cwd: string;
  home: string;
  environment: NodeJS.ProcessEnv;
};

const definitionsById = {
  'claude-code': {
    harness: 'claude-code',
    displayName: 'Claude Code',
    command: 'claude',
    paths: ({ home, environment }) => {
      const globalConfig = configuredPath(environment, 'CLAUDE_CONFIG_DIR') ?? join(home, '.claude');

      return claudeLocation(home, globalConfig);
    },
    markers: (location) => [location.config, location.skills],
  },
  opencode: {
    harness: 'opencode',
    displayName: 'OpenCode',
    command: 'opencode',
    paths: ({ home, environment }) => {
      const configHome = configuredPath(environment, 'XDG_CONFIG_HOME') ?? join(home, '.config');
      const globalConfig =
        configuredPath(environment, 'OPENCODE_CONFIG_DIR') ?? join(configHome, 'opencode');

      return claudeLocation(globalConfig, globalConfig);
    },
    markers: (location) => [location.config, location.skills],
  },
  codex: {
    harness: 'codex',
    displayName: 'Codex',
    command: 'codex',
    paths: ({ home, environment }) => {
      const globalConfig = configuredPath(environment, 'CODEX_HOME') ?? join(home, '.codex');

      return codexLocation(
        home,
        globalConfig,
        join(home, '.agents', 'skills'),
        globalConfig,
        globalConfig,
      );
    },
    markers: (location) => [location.config, location.skills, location.agents],
  },
} satisfies Record<Harness, HarnessDefinition>;

const definitions = Object.values(definitionsById);

export function getHarnessDefinitions(): readonly HarnessDefinition[] {
  return definitions;
}

function isHarness(value: string): value is Harness {
  return value in definitionsById;
}

export function getHarnessDefinition(value: string): HarnessDefinition {
  if (!isHarness(value)) {
    throw new Error(`Unsupported harness: ${value}`);
  }

  return definitionsById[value];
}

export function resolveHarnessPaths(
  harness: Harness,
  options: HarnessPathOptions = {},
): HarnessLocation {
  return getHarnessDefinition(harness).paths(harnessContext(options));
}

export async function detectHarnesses(
  options: HarnessPathOptions = {},
): Promise<HarnessDetection[]> {
  const context = harnessContext(options);

  return Promise.all(
    definitions.map(async (definition) => {
      const location = definition.paths(context);
      const [executable, paths] = await Promise.all([
        findExecutable(definition.command, context.environment),
        existingPaths(definition.markers(location)),
      ]);
      const configured = paths.length > 0;

      return {
        harness: definition.harness,
        displayName: definition.displayName,
        command: definition.command,
        executable: executable ?? null,
        configured,
        paths,
        detected: executable !== undefined || configured,
      };
    }),
  );
}

function harnessContext(options: HarnessPathOptions): HarnessPathContext {
  return {
    cwd: resolve(options.cwd ?? process.cwd()),
    home: resolve(options.homeDirectory ?? homedir()),
    environment: { ...process.env, ...options.environment },
  };
}

function claudeLocation(root: string, config: string): HarnessLocation {
  return {
    root,
    config,
    skills: join(config, 'skills'),
    agents: join(config, 'agents'),
    rules: join(config, 'rules'),
    guidance: root,
  };
}

function codexLocation(
  root: string,
  config: string,
  skills: string,
  agentsRoot: string,
  guidance: string,
): HarnessLocation {
  return {
    root,
    config,
    skills,
    agents: join(agentsRoot, 'agents'),
    rules: join(root, '.ai-directory', 'rules'),
    guidance,
  };
}

async function existingPaths(paths: string[]): Promise<string[]> {
  const results = await Promise.all(
    paths.map(async (path) => (await pathExists(path) ? path : undefined)),
  );

  return results.filter((path): path is string => path !== undefined);
}

async function findExecutable(
  command: string,
  environment: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  const pathEntries = (environment.PATH ?? '').split(delimiter).filter(Boolean);
  const suffixes = process.platform === 'win32'
    ? (environment.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')
    : [''];

  for (const directory of pathEntries) {
    for (const suffix of suffixes) {
      const candidate = join(directory, `${command}${suffix}`);

      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
      }
    }
  }

  return undefined;
}