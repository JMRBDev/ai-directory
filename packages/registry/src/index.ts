import { readFile } from 'node:fs/promises';
import {
  registryIndexSchema,
  type RegistryIndex,
} from '@ai-directory/contracts';

function parseRegistryIndex(data: unknown, source: string): RegistryIndex {
  const result = registryIndexSchema.safeParse(data);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'index'}: ${issue.message}`)
      .join('; ');

    throw new Error(`Registry index is invalid (${source}): ${issues}`);
  }

  return result.data;
}

export async function readRegistryIndex(filePath: string): Promise<RegistryIndex> {
  let contents: string;

  try {
    contents = await readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Registry index not found: ${filePath}`, { cause: error });
  }

  let data: unknown;

  try {
    data = JSON.parse(contents);
  } catch (error) {
    throw new Error(`Registry index is not valid JSON: ${filePath}`, { cause: error });
  }

  return parseRegistryIndex(data, filePath);
}

export async function fetchRegistryIndex(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<RegistryIndex> {
  let response: Response;

  try {
    response = await fetcher(url);
  } catch (error) {
    throw new Error(`Could not fetch registry index: ${url}`, { cause: error });
  }

  if (!response.ok) {
    throw new Error(
      `Registry index request failed (${response.status} ${response.statusText}): ${url}`,
    );
  }

  let data: unknown;

  try {
    data = await response.json();
  } catch (error) {
    throw new Error(`Registry index response is not valid JSON: ${url}`, { cause: error });
  }

  return parseRegistryIndex(data, url);
}
