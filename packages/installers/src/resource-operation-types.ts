import type {
  ToolDependencyInstallResult,
  ToolDependencyRemovalCandidate,
  ToolDependencyUninstallResult,
} from './dependencies.js';
import type { Harness } from './harnesses.js';
import type { InstallationRecord } from './installation-records.js';
import type { InstallOptions } from './install-types.js';
import type { ResourceVersion } from '@ai-directory/registry';

export interface ResourceOperation {
  resource: string;
  harnesses: Harness[];
  action: 'install' | 'uninstall';
  version?: string;
  resources?: ResourceVersion[];
  resourceIds?: string[];
  pack?: ResourcePackOperation;
  warningResources?: ResourceVersion[];
}

export type ResourcePackEntry = {
  resource: string;
  version: string;
};

export type ResourcePackOperation = {
  version: string;
  resources: ResourcePackEntry[];
};

export type PlannedResourceChange = {
  path: string;
  action: 'added' | 'modified' | 'removed';
  resource: string;
  harness: Harness;
  before?: string;
  after?: string;
};

export type ResourceChangePlan = {
  operations: ResourceOperation[];
  changes: PlannedResourceChange[];
  conflicts: string[];
  warnings: string[];
  projectionNotes: string[];
  dependencyRemovals: ToolDependencyRemovalCandidate[];
  fingerprint: string;
};

export type ResourceChangeOptions = Pick<
  InstallOptions,
  | 'cwd'
  | 'homeDirectory'
  | 'environment'
  | 'scope'
  | 'installDependencies'
  | 'removeDependencies'
  | 'dependencyCommandRunner'
  | 'installationOwner'
>;

export type ResourceApplyResult = {
  plan: ResourceChangePlan;
  installed: InstallationRecord[];
  removed: InstallationRecord[];
  warnings: string[];
  dependencies: ToolDependencyInstallResult[];
  removedDependencies: ToolDependencyUninstallResult[];
  dependencyRemovals: ToolDependencyRemovalCandidate[];
};
