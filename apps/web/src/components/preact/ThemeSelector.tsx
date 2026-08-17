import { useState } from 'preact/hooks';
import { useMountEffect } from './useMountEffect';

type Theme = 'system' | 'light' | 'dark';

const THEME_STORAGE_KEY = 'ai-directory-theme';

const options: Array<{ value: Theme; label: string; icon: string }> = [
  { value: 'system', label: 'System', icon: 'monitor' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
];

function valid(value: string | null | undefined): value is Theme {
  return value === 'system' || value === 'light' || value === 'dark';
}

function readTheme(): Theme {
  const value = globalThis.document === undefined
    ? null
    : document.documentElement.dataset.themePreference;
  if (valid(value)) return value;
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return valid(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme === 'dark'
    || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
    ? 'dark'
    : 'light';
  document.documentElement.dataset.themePreference = theme;
}

export default function ThemeSelector() {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useMountEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const onSystem = () => { if (readTheme() === 'system') applyTheme('system'); };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      const next = valid(event.newValue) ? event.newValue : 'system';
      setTheme(next);
      applyTheme(next);
    };
    media.addEventListener?.('change', onSystem);
    window.addEventListener('storage', onStorage);
    return () => {
      media.removeEventListener?.('change', onSystem);
      window.removeEventListener('storage', onStorage);
    };
  });

  function choose(next: Theme) {
    setTheme(next);
    applyTheme(next);
    try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* storage is optional */ }
  }

  return (
    <fieldset className="fieldset">
      <legend className="fieldset-legend">Mode</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        {options.map((option) => (
          <label key={option.value} className="label cursor-pointer justify-start gap-3 rounded-box border border-base-300 px-3 py-3 has-checked:border-primary has-checked:bg-primary/10">
            <input className="radio radio-primary" type="radio" name="settings-theme" value={option.value} checked={theme === option.value} onChange={() => choose(option.value)} />
            <span className="inline-flex items-center gap-2">
              <i className={'ph ph-' + option.icon + ' text-lg'} aria-hidden="true" />
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}