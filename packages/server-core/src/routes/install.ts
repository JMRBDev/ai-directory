import { applyMcpOperations, applyResourceOperations } from '@ai-directory/installers';
import { readRegistrySourceResource } from '@ai-directory/registry';
import { registryEndpointFor } from '../environment.js';
import {
  isMcpResource,
  makeFileInstallOperation,
  makeMcpInstallOperation,
  pinnedRegistryId,
  readInstallationRecords,
  resolveInstallScope,
} from '../installations.js';
import { changeOptions } from '../planning.js';
import type { RouteContext } from '../types.js';
import { failureResponse, parseJsonBody, parseValidatedRequest } from './change-helpers.js';

function splitRegistrySuffix(resource: string): { id: string; registry?: string } {
  const at = resource.lastIndexOf('@');
  if (at <= 0) return { id: resource };
  const id = resource.slice(0, at).trim();
  const registry = resource.slice(at + 1).trim().toLowerCase();
  if (!id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(registry)) return { id: resource };
  return { id, registry };
}

export function registerInstallRoute({ app, options, cwd }: RouteContext): void {
  app.post('/api/install', async (context) => {
    const parsed = await parseJsonBody(context);
    if ('response' in parsed) return parsed.response;

    const validated = parseValidatedRequest(context, parsed.body);
    if ('response' in validated) return validated.response;

    try {
      const request = validated.request;
      const { id, registry: suffixRegistry } = splitRegistrySuffix(request.resource);
      const records = await readInstallationRecords(options.homeDirectory, cwd);
      const pinned = pinnedRegistryId(id, records);
      const registryId = request.registry ?? suffixRegistry ?? pinned;
      const endpoint = registryEndpointFor(options, cwd, registryId);
      const loaded = await readRegistrySourceResource(
        endpoint.source,
        id,
        request.version,
      );
      const isMcp = isMcpResource(id);
      const scope = resolveInstallScope(id, request.scope);
      const resourceOptions = changeOptions(options, cwd, undefined, {
        installDependencies: request.installDependencies,
      });
      const result = isMcp
        ? await applyMcpOperations(
            [makeMcpInstallOperation(id, request.harnesses, scope, loaded, request.version, endpoint.id)],
            changeOptions(options, cwd, scope),
            request.force,
        )
        : await applyResourceOperations(
            [makeFileInstallOperation(id, request.harnesses, loaded, request.version, endpoint.id)],
            resourceOptions,
            request.force,
          );

      return context.json({
        resource: loaded.resource,
        registry: endpoint.id,
        harnesses: request.harnesses,
        records: result.installed,
        warnings: result.warnings,
        dependencies: isMcp || !('dependencies' in result) ? [] : result.dependencies,
      });
    } catch (caught) {
      return failureResponse(context, caught);
    }
  });
}
