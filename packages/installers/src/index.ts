export { isMissingPathError, pathExists } from '@ai-directory/config';

export * from './dependencies.js';
export * from './mcp.js';

export {
  detectHarnesses,
  getHarnessDefinition,
  getHarnessDefinitions,
  resolveHarnessPaths,
} from './harnesses.js';
export type {
  Harness,
  HarnessDefinition,
  HarnessDetection,
  HarnessLocation,
  HarnessPathContext,
  HarnessPathOptions,
} from './harnesses.js';

export { discoverLocalResources, enrichLocalResources } from './discovery.js';
export type {
  LocalResource,
  LocalResourceRegistryState,
  LocalResourceState,
  ResourceDiscoveryOptions,
} from './discovery.js';

export type { InstallChange, InstallOptions, InstallResult, SharedOwnership } from './install-types.js';
export type {
  PlannedResourceChange,
  ResourceApplyResult,
  ResourceChangeOptions,
  ResourceChangePlan,
  ResourceOperation,
  ResourcePackEntry,
  ResourcePackOperation,
} from './resource-operation-types.js';
export {
  installationManifestSchema,
  installationPackRecordSchema,
  installationRecordSchema,
} from './installation-records.js';
export type {
  InstallationManifest,
  InstallationPackRecord,
  InstallationRecord,
} from './installation-records.js';
export {
  assertInstalledFor,
  createInstallationRecords,
  readInstallationManifest,
  removeInstallationPackRecords,
  removeInstallationRecord,
  removeToolDependencyRecords,
  updateInstallationManifest,
  updateInstallationPackRecords,
  updateToolDependencyRecords,
} from './installation-records.js';
export { getHarnessAdapter, openCodeInstaller } from './adapters.js';
export type { HarnessAdapter, ResourceInstallationMode, ResourceKind } from './adapters.js';
export { installClaudeCodeResources } from './plans/claude-code.js';
export { installOpenCodeResources } from './plans/opencode.js';
export { installCodexResources } from './plans/codex.js';
export { hashContent, fingerprintPaths, hashFile } from './hashing.js';
export { currentFile, restoreFiles, snapshotFiles } from './file-snapshots.js';
export type { FileSnapshot } from './file-snapshots.js';
export { withInstallationLocks } from './installation-locks.js';
export { applyChangePlanEnvelope } from './change-envelope.js';
export { removeStaleInstallationFiles, uninstallInstallation } from './install-cleanup.js';
export { resourceType } from './resources.js';
export { pickOpenCodeConfig } from './opencode-config.js';
export {
  applyResourceOperations,
  planResourceOperations,
  publicOperation,
  requestWarnings,
} from './resource-operations.js';
export { errorMessage } from './errors.js';
