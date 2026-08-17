export async function request<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(base + path, init);
  // SAFETY: The local API returns a JSON object; T is the caller's declared response contract.
  const result = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(result.error ?? 'The local API request failed.');
  return result;
}

export function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

export function closeDrawers(...ids: string[]) {
  for (const id of ids) {
    // SAFETY: DrawerShell renders each toggle id as a checkbox input.
    const toggle = document.getElementById(id) as HTMLInputElement | null;
    if (toggle) toggle.checked = false;
  }
}
