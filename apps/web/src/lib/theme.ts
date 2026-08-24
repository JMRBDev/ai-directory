export function readStorage<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    // SAFETY: The browser stores JSON written by writeStorage under this application-owned key.
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

export function writeStorage<T>(key: string, value: T) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A private browsing session can reject localStorage. The UI still works for this session.
  }
}

export function subscribeSystemTheme(onChange: () => void) {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const handleChange = () => {
    if (document.documentElement.dataset.themePreference === 'system') {
      document.documentElement.classList.toggle('dark', media.matches);
    }
    onChange();
  };
  media.addEventListener('change', handleChange);
  return () => media.removeEventListener('change', handleChange);
}

export function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function getServerSystemTheme() {
  return false;
}
