import { useState } from 'preact/hooks';
import { closeDrawers, errorMessage, request } from './api';
import DrawerShell from './DrawerShell';

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
      const result = await request<ConfigResponse>(apiUrl, '/api/config');
      setRepository(result.repository ?? '');
      setScope(result.source === 'project' ? 'project' : 'user');
      setSource(result.source === 'none' ? 'Not configured' : result.source);
      showStatus(result.repository ? 'Ready to use.' : 'Enter a registry repository to get started.');
    } catch (cause) {
      showStatus(errorMessage(cause, 'Could not reach the local API.'), true);
    }
  }

  async function mutate(path: string, init: RequestInit, success: (result: ConfigResponse) => string) {
    setBusy(true);
    showStatus(path === '/api/config' ? 'Saving…' : 'Clearing…');
    try {
      const result = await request<ConfigResponse>(apiUrl, path, init);
      setSource(result.source === 'none' ? 'Not configured' : result.source);
      if (result.repository !== undefined) setRepository(result.repository);
      showStatus(success(result));
    } catch (cause) {
      showStatus(errorMessage(cause, 'Could not update settings.'), true);
    } finally {
      setBusy(false);
    }
  }

  function saveSettings(event: SubmitEvent) {
    event.preventDefault();
    const value = repository.trim();
    if (!value) {
      showStatus('A Git URL is required.', true);
      return;
    }

    void mutate('/api/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repository: value, scope }),
    }, (result) => result.source !== result.savedScope
      ? 'Saved in the ' + result.savedScope + ' config. The ' + result.source + ' setting is still active.'
      : 'Saved in the ' + result.savedScope + ' config.');
  }

  function clearSettings() {
    void mutate('/api/config?scope=' + scope, { method: 'DELETE' }, (result) => result.source !== 'none' && result.source !== result.clearedScope
      ? 'Cleared the ' + result.clearedScope + ' config. The ' + result.source + ' setting is still active.'
      : 'Cleared the ' + result.clearedScope + ' config.');
  }

  return (
    <DrawerShell
      id="settings-drawer-toggle"
      title="Registry connection"
      onOpen={() => { closeDrawers('change-deck-toggle', 'publish-drawer-toggle'); void loadSettings(); }}
    >
      <div className="min-h-0 flex-1">
        <div className="flex items-center justify-between gap-4">
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
              <label className="label cursor-pointer justify-start gap-3 rounded-box border border-base-300 px-3 py-3 has-checked:border-primary has-checked:bg-primary/10">
                <input className="radio radio-primary" type="radio" name="settings-scope" value="user" checked={scope === 'user'} onChange={() => setScope('user')} disabled={busy} />
                This user
              </label>
              <label className="label cursor-pointer justify-start gap-3 rounded-box border border-base-300 px-3 py-3 has-checked:border-primary has-checked:bg-primary/10">
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
      </div>
    </DrawerShell>
  );
}
