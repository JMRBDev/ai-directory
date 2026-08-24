import type { ConfigScope } from '@ai-directory/config';
import type { DependencyCommandRunner } from './dependencies.js';

export type InstallOptions = {
  cwd?: string;
  homeDirectory?: string;
  force?: boolean;
  dryRun?: boolean;
  scope?: ConfigScope;
  environment?: NodeJS.ProcessEnv;
  installDependencies?: boolean;
  removeDependencies?: boolean;
  dependencyCommandRunner?: DependencyCommandRunner;
  installationOwner?: string;
};

export type InstallResult = {
  destination: string;
  files: string[];
  skippedFiles: string[];
  paths: string[];
  ownedPaths: string[];
  fileHashes: Record<string, string>;
  shared?: SharedOwnership[] | undefined;
  changes?: InstallChange[];
};

export type InstallChange = {
  path: string;
  content: string | null;
};

export type SharedOwnership = {
  path: string;
  key: string;
  hash: string;
  created?: boolean | undefined;
};
