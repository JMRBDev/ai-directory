export async function request<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(base + path, init);
  const result = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(result.error ?? 'The local API request failed.');
  return result;
}

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function closeDrawers(...ids: string[]) {
  for (const id of ids) {
    const toggle = document.getElementById(id) as HTMLInputElement | null;
    if (toggle) toggle.checked = false;
  }
}
