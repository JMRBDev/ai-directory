import type { Context } from 'hono';
import { errorMessage } from '@ai-directory/installers';
import { parseResourceRequest, requestError, type ResourceRequestData } from '../requests.js';
import type { RequestBody } from '../types.js';
import { jsonBody } from '../http.js';

export async function parseJsonBody(context: Context): Promise<{ body: RequestBody } | { response: Response }> {
  try {
    return { body: await jsonBody(context) };
  } catch {
    return { response: context.json({ error: 'Request body must be valid JSON.' }, 400) };
  }
}

export function parseValidatedRequest(
  context: Context,
  body: RequestBody,
): { request: ResourceRequestData } | { response: Response } {
  const error = requestError(body);
  if (error) return { response: context.json({ error }, 400) };
  return { request: parseResourceRequest(body) };
}

const NOT_FOUND_PATTERNS = [/not found/iu, /is not installed/iu];
const CLIENT_ERROR_PATTERNS = [
  /already installed/iu,
  /already absent/iu,
  /use --force/iu,
  /conflict/iu,
  /overlap/iu,
  /not available/iu,
  /outdated/iu,
  /modified/iu,
  /ownership hashes/iu,
  /unsupported/iu,
  /must be a/iu,
  /must include/iu,
  /is required/iu,
  /already exists/iu,
];

export function failureResponse(context: Context, caught: unknown): Response {
  const message = errorMessage(caught);
  if (NOT_FOUND_PATTERNS.some((pattern) => pattern.test(message))) {
    return context.json({ error: message }, 404);
  }
  if (CLIENT_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
    return context.json({ error: message }, 400);
  }
  console.error(message);
  return context.json({ error: 'The local operation failed. Check the local server output for details.' }, 500);
}
