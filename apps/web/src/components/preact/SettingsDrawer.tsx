import { useState } from 'preact/hooks';
import { useMountEffect } from './useMountEffect';

type Props = {
  apiUrl: string;
};

type ConfigResponse = {
  repository?: string;
  source: string;
  savedScope?: string;
  clearedScope?: string;
};

export default function SettingsDrawer({ apiUrl }: Props) {
  const [open, setOpen] = useState(false);
  const [repository, setRepository] = useState('');
  const [scope, setScope] = useState<'user' | 'project'>('user');
  const [source, setSource] = useState('Loading');
  const [status, setStatus] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  function showStatus(message: string, isError = false) {
    setStatus(message);
    setError(isError);
  }

  async function loadSettings() {
    try {
      const response = await fetch(apiUrl + '/api/config');
      const result = await response.json() as ConfigResponse & { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not load settings.');
      setRepository(result.repository ?? '');
      setScope(result.source === 'project' ? 'project' : 'user');
      setSource(result.source === 'none' ? 'Not configured' : result.source);
      showStatus(result.repository ? 'Ready to use.' : 'Enter a registry repository to get started.');
    } catch (cause) {
      showStatus(cause instanceof Error ? cause.message : 'Could not reach the local API.', true);
    }
  }

  function openDrawer() {
    document.querySelector<HTMLButtonElement>('[data-close-review]')?.click();
    setOpen(true);
    void loadSettings();
  }

  useMountEffect(() => {
    const opener = document.querySelector<HTMLButtonElement>('[data-open-settings]');
    const onOpen = () => openDrawer();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    opener?.addEventListener('click', onOpen);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      opener?.removeEventListener('click', onOpen);
      document.removeEventListener('keydown', onKeyDown);
    };
  });

  async function saveSettings(event: SubmitEvent) {
    event.preventDefault();
    const value = repository.trim();
    if (!value) {
      showStatus('A Git URL is required.', true);
      return;
    }

    setBusy(true);
    showStatus('Saving…');
    try {
      const response = await fetch(apiUrl + '/api/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repository: value, scope }),
      });
      const result = await response.json() as ConfigResponse & { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not save settings.');
      setSource(result.source);
      showStatus(result.source !== result.savedScope
        ? 'Saved in the ' + result.savedScope + ' config. The ' + result.source + ' setting is still active.'
        : 'Saved in the ' + result.savedScope + ' config.');
    } catch (cause) {
      showStatus(cause instanceof Error ? cause.message : 'Could not save settings.', true);
    } finally {
      setBusy(false);
    }
  }

  async function clearSettings() {
    setBusy(true);
    showStatus('Clearing…');
    try {
      const response = await fetch(apiUrl + '/api/config?scope=' + scope, { method: 'DELETE' });
      const result = await response.json() as ConfigResponse & { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not clear settings.');
      setRepository(result.repository ?? '');
      setSource(result.source === 'none' ? 'Not configured' : result.source);
      showStatus(result.source !== 'none' && result.source !== result.clearedScope
        ? 'Cleared the ' + result.clearedScope + ' config. The ' + result.source + ' setting is still active.'
        : 'Cleared the ' + result.clearedScope + ' config.');
    } catch (cause) {
      showStatus(cause instanceof Error ? cause.message : 'Could not clear settings.', true);
    } finally {
      setBusy(false);
    }
  }

  const panelStyle = {
    transform: open ? 'translateX(0)' : 'translateX(100%)',
    translate: open ? '0%' : '100%',
    transition: 'none',
  };
  const sideStyle = {
    display: open ? 'grid' : 'none',
    visibility: open ? 'visible' : 'hidden',
    opacity: open ? 1 : 0,
    transition: 'none',
  };

  return (
    <div className={'drawer drawer-end fixed inset-0 z-50' + (open ? ' drawer-open' : ' pointer-events-none')} data-settings-drawer-root>
      <input className="drawer-toggle" id="settings-drawer-toggle" type="checkbox" checked={open} readOnly aria-hidden="true" tabIndex={-1} />
      <div className="drawer-content pointer-events-none" aria-hidden="true"></div>
      <div className="drawer-side" style={sideStyle}>
        <button className="drawer-overlay bg-neutral/30" type="button" aria-label="Close settings" onClick={() => setOpen(false)}></button>
        <aside
          className="card card-border min-h-full w-full max-w-xl overflow-y-auto rounded-none bg-base-100 text-base-content shadow-2xl"
          id="settings-drawer"
          style={panelStyle}
          aria-hidden={!open}
          aria-labelledby="settings-title"
          role="dialog"
          aria-modal="true"
        >
          <div className="card-body min-h-full overflow-y-auto p-5 sm:p-6">
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-base-300 pb-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Settings</p>
                <h2 id="settings-title" className="mt-2 text-xl font-semibold tracking-tight text-base-content">Registry connection</h2>
                <p className="mt-2 text-sm text-base-content/60">Choose the Git repository used by the local CLI and website.</p>
              </div>
              <button className="btn btn-ghost btn-sm shrink-0" type="button" onClick={() => setOpen(false)}>Close</button>
            </div>

            <div className="min-h-0 flex-1">
              <div className="mt-5 flex items-center justify-between gap-4">
                <h3 className="text-sm font-semibold text-base-content">Repository</h3>
                <span className="badge badge-ghost">{source}</span>
              </div>

              <form className="mt-5 space-y-6" onSubmit={saveSettings}>
                <label className="fieldset">
                  <span className="fieldset-legend">Git URL</span>
                  <input className="input input-bordered w-full" type="text" placeholder="git@github.com:company/ai-directory-registry.git" value={repository} onInput={(event) => setRepository(event.currentTarget.value)} required disabled={busy} />
                </label>

                <fieldset className="fieldset">
                  <legend className="fieldset-legend">Save for</legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="label cursor-pointer justify-start gap-3 rounded-box border border-base-300 px-3 py-3 has-[:checked]:border-primary has-[:checked]:bg-primary/10">
                      <input className="radio radio-primary" type="radio" name="settings-scope" value="user" checked={scope === 'user'} onChange={() => setScope('user')} disabled={busy} />
                      This user
                    </label>
                    <label className="label cursor-pointer justify-start gap-3 rounded-box border border-base-300 px-3 py-3 has-[:checked]:border-primary has-[:checked]:bg-primary/10">
                      <input className="radio radio-primary" type="radio" name="settings-scope" value="project" checked={scope === 'project'} onChange={() => setScope('project')} disabled={busy} />
                      This project
                    </label>
                  </div>
                </fieldset>

                <div className="flex flex-wrap gap-3">
                  <button className="btn btn-primary" type="submit" disabled={busy}>Save settings</button>
                  <button className="btn btn-ghost" type="button" onClick={() => void clearSettings()} disabled={busy}>Clear selected scope</button>
                </div>
                <p className={'text-sm ' + (error ? 'text-error' : 'text-base-content/60')} role="status">{status}</p>
              </form>

              <div className="mt-8 border-t border-base-300 pt-5">
                <p className="font-semibold text-base-content">Credentials</p>
                <p className="mt-1 text-sm leading-6 text-base-content/60">AI Directory uses the Git credentials already configured on this computer.</p>
                <div className="mockup-code mt-3 w-fit text-xs">
                  <pre data-prefix="$"><code>aid doctor</code></pre>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
