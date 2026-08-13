import { useState } from 'preact/hooks';
import { useMountEffect } from './useMountEffect';

type Theme = 'system' | 'light' | 'dark';
const labels: Record<Theme, string> = { system: 'System', light: 'Light', dark: 'Dark' };
const icon: Record<Theme, string> = { system: 'monitor', light: 'sun', dark: 'moon' };

function valid(value: string | null | undefined): value is Theme {
  return value === 'system' || value === 'light' || value === 'dark';
}

function readTheme(): Theme {
  const value = typeof document === 'undefined'
    ? null
    : document.documentElement.dataset.themePreference;
  if (valid(value)) return value;
  try {
    const stored = localStorage.getItem('ai-directory-theme');
    return valid(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme === 'dark'
    || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
    ? 'dark'
    : 'light';
  document.documentElement.dataset.themePreference = theme;
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useMountEffect(() => {
    const control = document.querySelector<HTMLDetailsElement>('[data-theme-control]');
    const media = matchMedia('(prefers-color-scheme: dark)');
    const close = () => { if (control) control.open = false; };
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Node && control && !control.contains(event.target)) close();
    };
    const onSystem = () => { if (readTheme() === 'system') apply('system'); };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== 'ai-directory-theme') return;
      const next = valid(event.newValue) ? event.newValue : 'system';
      setTheme(next);
      apply(next);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    media.addEventListener?.('change', onSystem);
    window.addEventListener('storage', onStorage);
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      media.removeEventListener?.('change', onSystem);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  });

  function choose(next: Theme, event: MouseEvent) {
    setTheme(next);
    apply(next);
    try { localStorage.setItem('ai-directory-theme', next); } catch { /* storage is optional */ }
    (event.currentTarget as HTMLElement).closest('details')?.removeAttribute('open');
  }

  return (
    <details className="dropdown dropdown-end shrink-0" data-theme-control>
      <summary className="btn btn-ghost btn-square btn-sm list-none text-base-content hover:bg-primary/10 hover:text-primary" aria-label={'Theme: ' + labels[theme]} title={'Theme: ' + labels[theme]}>
        <i className={'ph ph-' + icon[theme] + ' text-lg'} aria-hidden="true" />
      </summary>
      <ul className="dropdown-content menu menu-sm z-50 mt-2 w-44 rounded-box border border-base-300 bg-base-100 p-1 shadow-lg shadow-neutral/10" role="menu" aria-label="Choose theme">
        {(Object.keys(labels) as Theme[]).map((option) => (
          <li key={option}>
            <button className="w-full justify-between text-left" type="button" data-theme-option={option} role="menuitemradio" aria-checked={theme === option} onClick={(event) => choose(option, event)}>
              <span>{labels[option]}</span>
              {theme === option && <i className="ph ph-check text-primary" aria-hidden="true" />}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
