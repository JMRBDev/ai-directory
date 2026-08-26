export { errorMessage } from './errors.js';

export {
  dependencyStatusMessage,
  inspectToolDependencies,
  installToolDependencies,
  toolDependencyRemovalCandidates,
} from './dependencies.js';
export type {
  DependencyCommandRunner,
  ToolDependencyRemovalCandidate,
  ToolDependencyStatus,
} from './dependencies.js';

export { applyMcpOperations, planMcpOperations } from './mcp.js';
export type { McpOperation } from './mcp.js';

export { detectHarnesses, getHarnessDefinition, resolveHarnessPaths } from './harnesses.js';
export type { Harness, HarnessDetection } from './harnesses.js';

export { discoverLocalResources, enrichLocalResources } from './discovery.js';
export type { LocalResource, ResourceDiscoveryOptions } from './discovery.js';

export type {
  PlannedResourceChange,
  ResourceChangeOptions,
  ResourceChangePlan,
  ResourceOperation,
  ResourcePackOperation,
} from './resource-operation-types.js';

export {
  assertInstalledFor,
  createInstallationRecords,
  readInstallationManifest,
  updateInstallationManifest,
} from './installation-records.js';
export type {
  InstallationManifest,
  InstallationPackRecord,
  InstallationRecord,
} from './installation-records.js';

export { getHarnessAdapter, openCodeInstaller } from './adapters.js';
export { installClaudeCodeResources } from './plans/claude-code.js';
export { installOpenCodeResources } from './plans/opencode.js';
export { installCodexResources } from './plans/codex.js';
export { removeStaleInstallationFiles, uninstallInstallation } from './install-cleanup.js';

export { applyResourceOperations, planResourceOperations } from './resource-operations.js';

export {
  inspectHarness,
  inspectHarnesses,
  installHarness,
  uninstallHarness,
  updateHarness,
} from './harness-management.js';
export type {
  HarnessActionResult,
  HarnessManagementOptions,
  HarnessStatus,
} from './harness-management.js';
