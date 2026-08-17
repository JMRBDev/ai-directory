import { DEFAULT_API_PORT, DEFAULT_API_URL } from '@ai-directory/config';

export function resolveApiUrl(hostname: string): string {
  return hostname.endsWith('.ts.net')
    ? `https://${hostname}:${DEFAULT_API_PORT}`
    : DEFAULT_API_URL;
}
