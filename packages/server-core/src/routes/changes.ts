import { resourceKey } from '@ai-directory/contracts';
import {
  applyMcpOperations,
  applyResourceOperations,
  assertInstalledFor,
  errorMessage,
  planMcpOperations,
  planResourceOperations,
  readInstallationManifest,
  type ResourceOperation,
} from '@ai-directory/installers';
import { readRegistrySourceResource } from '@ai-directory/registry';
import { registrySource } from '../environment.js';
import { isMcpResource, installManifestPath, installationPackOperation, installationResourceIds } from '../installations.js';
import {
  applyPlannedChange,
  changeOptions,
  resolveOperations,
  withRegistrySnapshot,
} from '../planning.js';
import { changePlanError, parseChangeOperations, parseResourceRequest, requestError } from '../requests.js';
import { jsonBody, queryBoolean } from '../http.js';
import type { RequestBody, RouteContext } from '../types.js';

export function registerChangeRoutes({ app, options, cwd }: RouteContext): void {
  app.post('/api/plan', async (context) => {
    let body: RequestBody;

    try {
      body = await jsonBody(context);
    } catch {
      return context.json({ error: 'Request body must be valid JSON.' }, 400);
    }

    const error = changePlanError(body);
    if (error) return context.json({ error }, 400);

    try {
      const request = parseChangeOperations(body);
      const plan = await withRegistrySnapshot(options, cwd, async (snapshot) => {
        const isMcp = request.operations.some((operation) => isMcpResource(operation.resource));
        if (isMcp && !request.operations.every((operation) => isMcpResource(operation.resource))) {
          throw new Error('A change plan cannot mix MCP servers with file resources.');
        }
        const scope = isMcp ? (request.operations[0]?.scope ?? 'user') : 'user';
        const changeScopeOptions = changeOptions(options, cwd, isMcp ? scope : undefined);

        if (isMcp) {
          return planMcpOperations(
            await resolveOperations(request.operations, snapshot, true),
            changeScopeOptions,
            request.force,
          );
        }

        return planResourceOperations(
          await resolveOperations(request.operations, snapshot, false),
          changeScopeOptions,
          request.force,
        );
      });
      return context.json(plan);
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 400);
    }
  });

  app.post('/api/apply', async (context) => {
    let body: RequestBody;

    try {
      body = await jsonBody(context);
    } catch {
      return context.json({ error: 'Request body must be valid JSON.' }, 400);
    }

    const error = changePlanError(body);
    if (error) return context.json({ error }, 400);

    try {
      const request = parseChangeOperations(body);
      const result = await withRegistrySnapshot(options, cwd, async (snapshot) => {
        const isMcp = request.operations.some((operation) => isMcpResource(operation.resource));
        if (isMcp && !request.operations.every((operation) => isMcpResource(operation.resource))) {
          throw new Error('A change plan cannot mix MCP servers with file resources.');
        }
        const scope = isMcp ? (request.operations[0]?.scope ?? 'user') : 'user';
        const changeScopeOptions = changeOptions(options, cwd, isMcp ? scope : undefined);

        if (isMcp) {
          const operations = await resolveOperations(request.operations, snapshot, true);
          const plan = await planMcpOperations(operations, changeScopeOptions, request.force);
          return applyPlannedChange(
            request.planFingerprint,
            request.force,
            plan,
            () => applyMcpOperations(operations, changeScopeOptions, request.force, plan),
          );
        }

        const operations = await resolveOperations(request.operations, snapshot, false);
        const applyOptions = changeOptions(options, cwd, undefined, {
          installDependencies: request.installDependencies,
          removeDependencies: request.removeDependencies,
        });
        const plan = await planResourceOperations(operations, applyOptions, request.force);
        return applyPlannedChange(
          request.planFingerprint,
          request.force,
          plan,
          () => applyResourceOperations(operations, applyOptions, request.force, plan),
        );
      });
      if (result.stale) {
        return context.json({
          error: 'The change plan is outdated. Generate a new preview before applying.',
          ...result.plan,
        }, 409);
      }
      if (result.conflict) {
        return context.json({ error: 'The change plan contains conflicts.', ...result.plan }, 409);
      }
      return context.json({ ...result.result, plan: result.plan });
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 400);
    }
  });

  app.post('/api/install', async (context) => {
    let body: RequestBody;

    try {
      body = await jsonBody(context);
    } catch {
      return context.json({ error: 'Request body must be valid JSON.' }, 400);
    }

    const error = requestError(body);
    if (error) return context.json({ error }, 400);

    try {
      const request = parseResourceRequest(body);
      const loaded = await readRegistrySourceResource(
        registrySource(options, cwd),
        request.resource,
        request.version,
      );
      const isMcp = isMcpResource(request.resource);
      const scope = isMcp ? (request.scope ?? 'user') : 'user';
      const resourceOperation: ResourceOperation = {
        ...request,
        action: 'install' as const,
        resources: loaded.resources,
        warningResources: [loaded.resource, ...loaded.resources],
      };
      if (loaded.resource.resource.type === 'templates') {
        resourceOperation.pack = {
          version: loaded.resource.version,
          resources: loaded.resources.map((resource) => ({
            resource: resourceKey(resource.resource),
            version: resource.version,
          })),
        };
      }
      const resourceOptions = changeOptions(options, cwd, undefined, {
        installDependencies: request.installDependencies,
      });
      const result = isMcp
        ? await applyMcpOperations(
            [{
              resource: request.resource,
              harnesses: request.harnesses,
              action: 'install',
              scope,
              resources: loaded.resources,
              warningResources: [loaded.resource, ...loaded.resources],
            }],
            changeOptions(options, cwd, scope),
            request.force,
        )
        : await applyResourceOperations(
            [resourceOperation],
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
      return context.json({ error: errorMessage(caught) }, 400);
    }
  });

  app.post('/api/update', async (context) => {
    let body: RequestBody;

    try {
      body = await jsonBody(context);
    } catch {
      return context.json({ error: 'Request body must be valid JSON.' }, 400);
    }

    const error = requestError(body);
    if (error) return context.json({ error }, 400);

    try {
      const request = parseResourceRequest(body);
      const isMcp = isMcpResource(request.resource);
      const scope = isMcp ? (request.scope ?? 'user') : 'user';
      const manifest = await readInstallationManifest(
        installManifestPath(scope, options, cwd),
      );
      const loaded = await readRegistrySourceResource(
        registrySource(options, cwd),
        request.resource,
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

      const resourceOperation: ResourceOperation = {
        ...request,
        harnesses: updatedHarnesses,
        action: 'install' as const,
        resources: loaded.resources,
        warningResources: [loaded.resource, ...loaded.resources],
      };
      if (loaded.resource.resource.type === 'templates') {
        resourceOperation.pack = {
          version: loaded.resource.version,
          resources: loaded.resources.map((resource) => ({
            resource: resourceKey(resource.resource),
            version: resource.version,
          })),
        };
      }
      const resourceOptions = changeOptions(options, cwd, undefined, {
        installDependencies: request.installDependencies,
      });
      const result = isMcp
        ? await applyMcpOperations(
            [{
              resource: request.resource,
              harnesses: updatedHarnesses,
              action: 'install',
              scope,
              resources: loaded.resources,
              warningResources: [loaded.resource, ...loaded.resources],
            }],
            changeOptions(options, cwd, scope),
            request.force,
        )
        : await applyResourceOperations(
            [resourceOperation],
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
      return context.json({ error: errorMessage(caught) }, 400);
    }
  });

  app.delete('/api/installed', async (context) => {
    const rawRequest = {
      resource: context.req.query('resource'),
      harnesses: context.req.query('harnesses'),
      force: queryBoolean(context.req.query('force')),
      removeDependencies: queryBoolean(context.req.query('removeDependencies')),
    };
    const error = requestError(rawRequest);

    if (error) return context.json({ error }, 400);

    try {
      const request = parseResourceRequest(rawRequest);
      const isMcp = isMcpResource(request.resource);
      const scope = isMcp ? (request.scope ?? 'user') : 'user';
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
        : await (async () => {
            const operations: ResourceOperation[] = [];
            for (const harness of request.harnesses) {
              const resourceIds = await installationResourceIds(
                request.resource,
                source,
                manifest,
                [harness],
              );
              assertInstalledFor(manifest, resourceIds, [harness], request.resource);
              const operation: ResourceOperation = {
                ...request,
                harnesses: [harness],
                action: 'uninstall',
                resourceIds,
              };
              const pack = installationPackOperation(manifest, request.resource, harness);
              if (pack) operation.pack = pack;
              operations.push(operation);
            }

            return applyResourceOperations(
              operations,
              changeOptions(options, cwd, undefined, {
                removeDependencies: request.removeDependencies,
              }),
              request.force,
            );
          })();

      return context.json({
        removed: result.removed,
        removedDependencies: isMcp || !('removedDependencies' in result) ? [] : result.removedDependencies,
        dependencyRemovals: isMcp || !('dependencyRemovals' in result) ? [] : result.dependencyRemovals,
        harnesses: request.harnesses,
      });
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 400);
    }
  });
}
