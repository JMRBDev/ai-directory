import { applyMcpOperations, applyResourceOperations } from '@ai-directory/installers';
import { readRegistrySourceResource } from '@ai-directory/registry';
import { registrySource } from '../environment.js';
import {
  isMcpResource,
  makeFileInstallOperation,
  makeMcpInstallOperation,
  resolveInstallScope,
} from '../installations.js';
import { changeOptions } from '../planning.js';
import type { RouteContext } from '../types.js';
import { failureResponse, parseJsonBody, parseValidatedRequest } from './change-helpers.js';

export function registerInstallRoute({ app, options, cwd }: RouteContext): void {
  app.post('/api/install', async (context) => {
    const parsed = await parseJsonBody(context);
    if ('response' in parsed) return parsed.response;

    const validated = parseValidatedRequest(context, parsed.body);
    if ('response' in validated) return validated.response;

    try {
      const request = validated.request;
      const loaded = await readRegistrySourceResource(
        registrySource(options, cwd),
        request.resource,
        request.version,
      );
      const isMcp = isMcpResource(request.resource);
      const scope = resolveInstallScope(request.resource, request.scope);
      const resourceOptions = changeOptions(options, cwd, undefined, {
        installDependencies: request.installDependencies,
      });
      const result = isMcp
        ? await applyMcpOperations(
            [makeMcpInstallOperation(request.resource, request.harnesses, scope, loaded, request.version)],
            changeOptions(options, cwd, scope),
            request.force,
        )
        : await applyResourceOperations(
            [makeFileInstallOperation(request.resource, request.harnesses, loaded, request.version)],
            resourceOptions,
            request.force,
          );

      return context.json({
        resource: loaded.resource,
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
