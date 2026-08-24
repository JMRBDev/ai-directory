import type { RequestBody } from './types.js';

export async function jsonBody(context: { req: { json: <T>() => Promise<T> } }): Promise<RequestBody> {
  return context.req.json<RequestBody>();
}

export function queryBoolean(value: string | undefined): boolean | string | undefined {
  if (value === undefined) return undefined;
  return value === 'true' ? true : value === 'false' ? false : value;
}
