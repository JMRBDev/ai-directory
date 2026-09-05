import { resourceKey } from '@ai-directory/contracts';
import {
  applyMcpOperations,
  applyResourceOperations,
  assertInstalledFor,
  readInstallationManifest,
} from '@ai-directory/installers';
import { readRegistrySourceResource } from '@ai-directory/registry';
import { registrySource } from '../environment.js';
import {
  installManifestPath,
  isMcpResource,
  makeFileInstallOperation,
  makeMcpInstallOperation,
  resolveInstallScope,
} from '../installations.js';
import { changeOptions } from '../planning.js';
import type { RouteContext } from '../types.js';
import { failureResponse, parseJsonBody, parseValidatedRequest } from './change-helpers.js';

export function registerUpdateRoute({ app, options, cwd }: RouteContext): void {
  app.post('/api/update', async (context) => {
    const parsed = await parseJsonBody(context);
    if ('response' in parsed) return parsed.response;

    const validated = parseValidatedRequest(context, parsed.body);
    if ('response' in validated) return validated.response;

    try {
      const request = validated.request;
      const isMcp = isMcpResource(request.resource);
      const scope = resolveInstallScope(request.resource, request.scope);
      const manifest = await readInstallationManifest(
        installManifestPath(scope, options, cwd),
      );
      const loaded = await readRegistrySourceResource(
        registrySource(options, cwd),
        request.resource,
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
        request.resource,
      );

      const existingRecords = existing.flatMap((records) =>
        records.filter(
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
          records: existingRecords,
          warnings: [],
        });
      }

      const resourceOptions = changeOptions(options, cwd, undefined, {
        installDependencies: request.installDependencies,
      });
      const result = isMcp
        ? await applyMcpOperations(
            [makeMcpInstallOperation(request.resource, updatedHarnesses, scope, loaded, loaded.resource.version)],
            changeOptions(options, cwd, scope),
            request.force,
        )
        : await applyResourceOperations(
            [makeFileInstallOperation(request.resource, updatedHarnesses, loaded, loaded.resource.version)],
            resourceOptions,
            request.force,
          );

      return context.json({
        updated: true,
        harnesses: updatedHarnesses,
        records: result.installed,
        warnings: result.warnings,
        dependencies: isMcp || !('dependencies' in result) ? [] : result.dependencies,
      });
    } catch (caught) {
      return failureResponse(context, caught);
    }
  });
}
