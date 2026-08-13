import { useState } from 'preact/hooks';
import { useMountEffect } from './useMountEffect';

type Theme = 'system' | 'light' | 'dark';

const labels: Record<Theme, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

function isTheme(value: string | null | undefined): value is Theme {
  return value === 'system' || value === 'light' || value === 'dark';
}

function readTheme(): Theme {
  if (typeof document !== 'undefined' && isTheme(document.documentElement.dataset.themePreference)) {
    return document.documentElement.dataset.themePreference;
  }

  try {
    const stored = localStorage.getItem('ai-directory-theme');
    return isTheme(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function applyTheme(theme: Theme) {
  const dark = theme === 'dark'
    || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.themePreference = theme;
}

export default function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>(readTheme);
  const [open, setOpen] = useState(false);

  useMountEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemChange = () => {
      if (readTheme() === 'system') applyTheme('system');
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== 'ai-directory-theme') return;
      const next = isTheme(event.newValue) ? event.newValue : 'system';
      setThemeState(next);
      applyTheme(next);
    };
    const onDocumentClick = (event: MouseEvent) => {
      const control = document.querySelector('[data-theme-control]');
      if (event.target instanceof Node && control && !control.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    media.addEventListener?.('change', onSystemChange);
    window.addEventListener('storage', onStorage);
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      media.removeEventListener?.('change', onSystemChange);
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('click', onDocumentClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  });

  function setTheme(theme: Theme) {
    setThemeState(theme);
    applyTheme(theme);
    try {
      localStorage.setItem('ai-directory-theme', theme);
    } catch {
      // Keep the current theme when storage is unavailable.
    }
    setOpen(false);
  }

  function moveFocus(direction: 1 | -1) {
    const options = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-theme-option]'));
    const index = options.findIndex((option) => option === document.activeElement);
    options[(index + direction + options.length) % options.length]?.focus();
  }

  const icon = theme === 'system' ? 'monitor' : theme === 'light' ? 'sun' : 'moon';

  return (
    <div className="dropdown dropdown-end shrink-0" data-theme-control>
      <button
        className="btn btn-ghost btn-square btn-sm text-base-content hover:bg-primary/10 hover:text-primary"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={'Theme: ' + labels[theme]}
        title={'Theme: ' + labels[theme]}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            requestAnimationFrame(() => {
              document.querySelector<HTMLButtonElement>('[data-theme-option][aria-checked="true"]')?.focus();
            });
          }
        }}
      >
        <i className={'ph ph-' + icon + ' text-lg'} aria-hidden="true"></i>
      </button>

      <div
        className={'dropdown-content menu menu-sm z-50 mt-2 w-44 rounded-box border border-base-300 bg-base-100 p-1 shadow-lg shadow-neutral/10' + (open ? '' : ' hidden')}
        role="menu"
        aria-label="Choose theme"
      >
        {(Object.keys(labels) as Theme[]).map((option) => (
          <li key={option}>
            <button
              className="w-full justify-between text-left"
              type="button"
              data-theme-option={option}
              role="menuitemradio"
              aria-checked={theme === option}
              onClick={() => setTheme(option)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  moveFocus(1);
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  moveFocus(-1);
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  setOpen(false);
                }
              }}
            >
              <span>{labels[option]}</span>
              {theme === option && <i className="ph ph-check text-primary" aria-hidden="true"></i>}
            </button>
          </li>
        ))}
      </div>
    </div>
  );
}
