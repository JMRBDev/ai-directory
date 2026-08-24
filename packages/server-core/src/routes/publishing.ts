import { errorMessage } from '@ai-directory/installers';
import {
  submitResource,
  validateResourceDirectory,
  type ResourceDirectoryValidationOptions,
  type SubmitResourceOptions,
} from '@ai-directory/registry';
import { registrySource } from '../environment.js';
import { parseResourceUpload, withResourceUpload } from '../uploads.js';
import type { MultipartBody, RouteContext } from '../types.js';

export function registerPublishingRoutes({ app, options, cwd }: RouteContext): void {
  app.post('/api/validate', async (context) => {
    let body: MultipartBody;

    try {
      body = await context.req.parseBody<{ all: true }, MultipartBody>({ all: true });
    } catch {
      return context.json({ error: 'Request body must be a valid multipart form.' }, 400);
    }

    const uploadResult = parseResourceUpload(body);
    if (!uploadResult.ok) return context.json({ error: uploadResult.error }, 400);
    const upload = uploadResult.upload;

    try {
      const result = await withResourceUpload(upload, (sourceDirectory) => {
        const validationOptions: ResourceDirectoryValidationOptions = {
          sourceDirectory,
          resourceId: upload.resourceId,
          version: upload.version,
        };
        if (upload.description) validationOptions.description = upload.description;

        return validateResourceDirectory(validationOptions);
      });

      return context.json({
        resource: `${result.resource.owner}/${result.resource.type}/${result.resource.name}`,
        version: upload.version,
        description: result.description,
        entryFile: result.entryFile.path,
        files: result.files.map((file) => file.path),
      });
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 400);
    }
  });

  app.post('/api/submit', async (context) => {
    let body: MultipartBody;

    try {
      body = await context.req.parseBody<{ all: true }, MultipartBody>({ all: true });
    } catch {
      return context.json({ error: 'Request body must be a valid multipart form.' }, 400);
    }

    const uploadResult = parseResourceUpload(body);
    if (!uploadResult.ok) return context.json({ error: uploadResult.error }, 400);
    const upload = uploadResult.upload;

    try {
      const source = registrySource(options, cwd);
      if (source.type !== 'remote') {
        return context.json(
          { error: 'Website publishing requires a configured Git registry, not a local index.' },
          400,
        );
      }

      const result = await withResourceUpload(upload, (sourceDirectory) => {
        const submitOptions: SubmitResourceOptions = {
          repositoryUrl: source.repositoryUrl,
          baseBranch: source.baseBranch,
          sourceDirectory,
          resourceId: upload.resourceId,
          version: upload.version,
        };
        if (upload.description) submitOptions.description = upload.description;
        if (options.commandRunner) submitOptions.commandRunner = options.commandRunner;

        return submitResource(submitOptions);
      });

      return context.json(result);
    } catch (caught) {
      return context.json({ error: errorMessage(caught) }, 400);
    }
  });
}
