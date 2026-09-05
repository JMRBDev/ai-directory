import { applyMcpOperations, applyResourceOperations, readInstallationManifest } from '@ai-directory/installers';
import { registrySource } from '../environment.js';
import {
  installationResourceIds,
  installManifestPath,
  isMcpResource,
  makeFileUninstallOperations,
  resolveInstallScope,
} from '../installations.js';
import { changeOptions } from '../planning.js';
import { parseResourceRequest, requestError } from '../requests.js';
import { queryBoolean } from '../http.js';
import type { RouteContext } from '../types.js';
import { failureResponse } from './change-helpers.js';

export function registerUninstallRoute({ app, options, cwd }: RouteContext): void {
  app.delete('/api/installed', async (context) => {
    const rawRequest = {
      resource: context.req.query('resource'),
      harnesses: context.req.query('harnesses'),
      scope: context.req.query('scope'),
      force: queryBoolean(context.req.query('force')),
      removeDependencies: queryBoolean(context.req.query('removeDependencies')),
    };
    const error = requestError(rawRequest);

    if (error) return context.json({ error }, 400);

    try {
      const request = parseResourceRequest(rawRequest);
      const isMcp = isMcpResource(request.resource);
      const scope = resolveInstallScope(request.resource, request.scope);
      const manifest = await readInstallationManifest(
        installManifestPath(scope, options, cwd),
      );
      const source = registrySource(options, cwd);
      const resourceIds = await installationResourceIds(
        request.resource,
        source,
        manifest,
        request.harnesses,
      );

      const result = isMcp
        ? await applyMcpOperations(
            [{
              resource: request.resource,
              harnesses: request.harnesses,
              action: 'uninstall',
              resourceIds,
              scope,
            }],
            changeOptions(options, cwd, scope),
            request.force,
          )
        : await applyResourceOperations(
            await makeFileUninstallOperations(
              request.resource,
              request.harnesses,
              (resource, harness) => installationResourceIds(resource, source, manifest, [harness]),
              manifest,
            ),
            changeOptions(options, cwd, undefined, {
              removeDependencies: request.removeDependencies,
            }),
            request.force,
          );

      return context.json({
        removed: result.removed,
        removedDependencies: isMcp || !('removedDependencies' in result) ? [] : result.removedDependencies,
        dependencyRemovals: isMcp || !('dependencyRemovals' in result) ? [] : result.dependencyRemovals,
        harnesses: request.harnesses,
      });
    } catch (caught) {
      return failureResponse(context, caught);
    }
  });
}
