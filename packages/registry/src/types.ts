import type { PluginManifest, RegistryIndex, ResourceSummary } from '@ai-directory/contracts';

export type CommandResult = {
  stdout: string;
  stderr: string;
};

export type CommandRunner = (
  command: string,
  args: string[],
  cwd: string,
) => Promise<CommandResult>;

export type ResourceFile = {
  path: string;
  content: string;
};

export type ResourceVersion = {
  resource: ResourceSummary;
  version: string;
  files: ResourceFile[];
};

export type RemoteResourceOptions = {
  repositoryUrl: string;
  resourceId: string;
  version?: string;
  baseBranch?: string;
  commandRunner?: CommandRunner;
};

export type RemoteRegistryOptions = {
  repositoryUrl: string;
  baseBranch?: string;
  commandRunner?: CommandRunner;
};

export type RegistrySource =
  | { type: 'local'; indexPath: string }
  | { type: 'remote'; repositoryUrl: string; baseBranch: string };

export type RegistrySnapshot = {
  source: RegistrySource;
  indexPath: string;
  readIndex(): Promise<RegistryIndex>;
  readResource(resourceId: string, version?: string): Promise<RemoteResourceResult>;
  close(): Promise<void>;
};

export type RemoteResourceResult = {
  resource: ResourceVersion;
  resources: ResourceVersion[];
};

export type RegistryValidationResult = {
  resourceCount: number;
  issues: string[];
};

export type PublishResourceOptions = {
  indexPath: string;
  sourceDirectory: string;
  resourceId: string;
  version: string;
  description?: string;
};

export type PublishResourceResult = {
  resource: ResourceSummary;
  packageDirectory: string;
  files: string[];
};

export interface ResourceDirectoryValidationOptions {
  sourceDirectory: string;
  resourceId: string;
  version: string;
  description?: string;
}

export type ResourceDirectoryValidationResult = {
  sourceDirectory: string;
  resource: Pick<ResourceSummary, 'owner' | 'type' | 'name'>;
  entryFile: ResourceFile;
  files: ResourceFile[];
  description: string;
};

export type SubmitResourceOptions = Omit<PublishResourceOptions, 'indexPath'> & {
  indexPath?: string;
  repositoryUrl?: string;
  baseBranch?: string;
  branch?: string;
  remote?: string;
  title?: string;
  body?: string;
  commandRunner?: CommandRunner;
};

export type SubmitResourceResult = {
  resource: ResourceSummary;
  branch: string;
  commit: string;
  pullRequestUrl: string;
  files: string[];
};

export type CachedRegistry = {
  get(source: RegistrySource): Promise<RegistrySnapshot>;
  refresh(): Promise<void>;
};

export interface RegistrySourceOptions {
  indexPath?: string;
  repositoryUrl?: string;
  baseBranch?: string;
}

export type PluginManifestResult = {
  file: ResourceFile;
  manifest: PluginManifest;
};
