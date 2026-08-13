import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

export type Harness = 'claude-code' | 'opencode' | 'codex';

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

export type HarnessPaths = {
  project: HarnessLocation;
  global: HarnessLocation;
};

export type HarnessDefinition = {
  harness: Harness;
  displayName: string;
  command: string;
  paths(options: HarnessPathContext): HarnessPaths;
  markers(paths: HarnessPaths): { project: string[]; global: string[] };
};

export type HarnessDetection = {
  harness: Harness;
  displayName: string;
  command: string;
  executable: string | null;
  project: { configured: boolean; paths: string[] };
  global: { configured: boolean; paths: string[] };
  detected: boolean;
};

export type HarnessPathContext = {
  cwd: string;
  home: string;
  environment: NodeJS.ProcessEnv;
};

const definitions: readonly HarnessDefinition[] = [
  {
    harness: 'claude-code',
    displayName: 'Claude Code',
    command: 'claude',
    paths: ({ cwd, home, environment }) => {
      const globalConfig = configuredPath(environment, 'CLAUDE_CONFIG_DIR') ?? join(home, '.claude');

      return {
        project: claudeLocation(cwd, join(cwd, '.claude')),
        global: claudeLocation(home, globalConfig),
      };
    },
    markers: ({ project, global }) => ({
      project: [project.config, project.skills],
      global: [global.config, global.skills],
    }),
  },
  {
    harness: 'opencode',
    displayName: 'OpenCode',
    command: 'opencode',
    paths: ({ cwd, home, environment }) => {
      const configHome = configuredPath(environment, 'XDG_CONFIG_HOME') ?? join(home, '.config');
      const globalConfig =
        configuredPath(environment, 'OPENCODE_CONFIG_DIR') ?? join(configHome, 'opencode');

      return {
        project: openCodeLocation(cwd, join(cwd, '.opencode')),
        global: openCodeLocation(globalConfig, globalConfig),
      };
    },
    markers: ({ project, global }) => ({
      project: [project.config, project.skills],
      global: [global.config, global.skills],
    }),
  },
  {
    harness: 'codex',
    displayName: 'Codex',
    command: 'codex',
    paths: ({ cwd, home, environment }) => {
      const globalConfig = configuredPath(environment, 'CODEX_HOME') ?? join(home, '.codex');

      return {
        project: codexLocation(
          cwd,
          join(cwd, '.codex'),
          join(cwd, '.agents', 'skills'),
          join(cwd, '.codex'),
          cwd,
        ),
        global: codexLocation(
          home,
          globalConfig,
          join(home, '.agents', 'skills'),
          globalConfig,
          globalConfig,
        ),
      };
    },
    markers: ({ project, global }) => ({
      project: [project.config, project.skills, project.agents],
      global: [global.config, global.skills, global.agents],
    }),
  },
];

export function getHarnessDefinitions(): readonly HarnessDefinition[] {
  return definitions;
}

export function getHarnessDefinition(value: string): HarnessDefinition {
  const definition = definitions.find(({ harness }) => harness === value);

  if (!definition) {
    throw new Error(`Unsupported harness: ${value}`);
  }

  return definition;
}

export function resolveHarnessPaths(
  harness: Harness,
  options: HarnessPathOptions = {},
): HarnessPaths {
  const environment = { ...process.env, ...options.environment };
  const context = {
    cwd: resolve(options.cwd ?? process.cwd()),
    home: resolve(options.homeDirectory ?? homedir()),
    environment,
  };

  return getHarnessDefinition(harness).paths(context);
}

export async function detectHarnesses(
  options: HarnessPathOptions = {},
): Promise<HarnessDetection[]> {
  const environment = { ...process.env, ...options.environment };
  const context = {
    cwd: resolve(options.cwd ?? process.cwd()),
    home: resolve(options.homeDirectory ?? homedir()),
    environment,
  };

  return Promise.all(
    definitions.map(async (definition) => {
      const paths = definition.paths(context);
      const markers = definition.markers(paths);
      const [executable, projectPaths, globalPaths] = await Promise.all([
        findExecutable(definition.command, environment),
        existingPaths(markers.project),
        existingPaths(markers.global),
      ]);
      const project = { configured: projectPaths.length > 0, paths: projectPaths };
      const global = { configured: globalPaths.length > 0, paths: globalPaths };

      return {
        harness: definition.harness,
        displayName: definition.displayName,
        command: definition.command,
        executable: executable ?? null,
        project,
        global,
        detected: executable !== undefined || project.configured || global.configured,
      };
    }),
  );
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

function openCodeLocation(root: string, config: string): HarnessLocation {
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

function configuredPath(environment: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = environment[key]?.trim();
  return value ? resolve(value) : undefined;
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

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
