export { discoverMcpServers } from './mcp/discovery.js';
export type { DiscoveredMcpServer } from './mcp/discovery.js';
export { applyMcpOperations, planMcpOperations, resourceName } from './mcp/operations.js';
export type {
  McpApplyResult,
  McpChange,
  McpOperation,
  McpPlan,
  McpServerEntry,
} from './mcp/types.js';
