import { resourceKey } from '@ai-directory/contracts';
import {
  applyMcpOperations,
  applyResourceOperations,
  assertInstalledFor,
  readInstallationManifest,
} from '@ai-directory/installers';
import { readRegistrySourceResource } from '@ai-directory/registry';
import { registryEndpointFor } from '../environment.js';
import {
  installManifestPath,
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

export function registerUpdateRoute({ app, options, cwd }: RouteContext): void {
  app.post('/api/update', async (context) => {
    const parsed = await parseJsonBody(context);
    if ('response' in parsed) return parsed.response;

    const validated = parseValidatedRequest(context, parsed.body);
    if ('response' in validated) return validated.response;

    try {
      const request = validated.request;
      const { id, registry: suffixRegistry } = splitRegistrySuffix(request.resource);
      // Update never auto-switches source. It stays on the pinned registry
      // unless the caller passes an explicit registry.
      const records = await readInstallationRecords(options.homeDirectory, cwd);
      const pinned = pinnedRegistryId(id, records);
      const registryId = request.registry ?? suffixRegistry ?? pinned;
      const endpoint = registryEndpointFor(options, cwd, registryId);
      const isMcp = isMcpResource(id);
      const scope = resolveInstallScope(id, request.scope);
      const manifest = await readInstallationManifest(
        installManifestPath(scope, options, cwd),
      );
      const loaded = await readRegistrySourceResource(
        endpoint.source,
        id,
        request.version,
      );
      const existing = request.harnesses.map((harness) =>
        loaded.resources.map((resource) =>
          manifest.installations.find(
            (record) =>
              record.resource === resourceKey(resource.resource) &&
              record.harness === harness,
          ),
        ),
      );

      assertInstalledFor(
        manifest,
        loaded.resources.map((resource) => resourceKey(resource.resource)),
        request.harnesses,
        id,
      );

      const existingRecords = existing.flatMap((found) =>
        found.filter(
          (record): record is NonNullable<typeof record> => record !== undefined,
        ),
      );

      const updatedHarnesses = request.harnesses.filter((_, index) =>
        loaded.resources.some(
          (resource, resourceIndex) =>
            resource.version !== existing[index]?.[resourceIndex]?.version,
        ),
      );

      if (updatedHarnesses.length === 0) {
        return context.json({
          updated: false,
          harnesses: request.harnesses,
          registry: endpoint.id,
          records: existingRecords,
          warnings: [],
        });
      }

      const resourceOptions = changeOptions(options, cwd, undefined, {
        installDependencies: request.installDependencies,
      });
      const result = isMcp
        ? await applyMcpOperations(
            [makeMcpInstallOperation(id, updatedHarnesses, scope, loaded, loaded.resource.version, endpoint.id)],
            changeOptions(options, cwd, scope),
            request.force,
        )
        : await applyResourceOperations(
            [makeFileInstallOperation(id, updatedHarnesses, loaded, loaded.resource.version, endpoint.id)],
            resourceOptions,
            request.force,
          );

      return context.json({
        updated: true,
        harnesses: updatedHarnesses,
        registry: endpoint.id,
        records: result.installed,
        warnings: result.warnings,
        dependencies: isMcp || !('dependencies' in result) ? [] : result.dependencies,
      });
    } catch (caught) {
      return failureResponse(context, caught);
    }
  });
}
