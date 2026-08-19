import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { closeDrawers, errorMessage, request } from './api';
import {
  API_PATHS,
  DRAWER_TOGGLES,
  HARNESS_DEFAULTS_EVENT,
  JSON_HEADERS,
  persistHarnessDefaults,
  readHarnessDefaults,
  useStatus,
} from './lib';
import DrawerShell from './DrawerShell';
import ThemeSelector from './ThemeSelector';
import { harnessOptions, type Harness, type InstallScope } from './types';
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

function Section({
  id,
  title,
  trailing,
  children,
}: {
  id: string;
  title: string;
  trailing?: ComponentChildren;
  children: ComponentChildren;
}) {
  return (
    <section className="py-6 first:pt-0 last:pb-0" aria-labelledby={id}>
      <div className="flex items-center justify-between gap-4">
        <h3 id={id} className="text-sm font-semibold text-base-content">{title}</h3>
        {trailing}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function SettingsDrawer({ apiUrl }: Props) {
  const [repository, setRepository] = useState('');
  const [scope, setScope] = useState<InstallScope>('user');
  const [source, setSource] = useState('Loading');
  const [harnesses, setHarnesses] = useState<Harness[]>(() => readHarnessDefaults());
  const { status, error, showStatus } = useStatus();
  const [busy, setBusy] = useState(false);

  useMountEffect(() => {
    setHarnesses(readHarnessDefaults());
    const handleHarnessDefaults = (event: Event) => {
      // SAFETY: persistHarnessDefaults dispatches this event with a Harness[] detail.
      const next = (event as CustomEvent<Harness[]>).detail;
      if (Array.isArray(next) && next.length > 0) setHarnesses(next);
    };
    window.addEventListener(HARNESS_DEFAULTS_EVENT, handleHarnessDefaults);
    return () => window.removeEventListener(HARNESS_DEFAULTS_EVENT, handleHarnessDefaults);
  });

  async function loadSettings() {
    try {
      const result = await request<ConfigResponse>(apiUrl, API_PATHS.config);
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
    showStatus(path === API_PATHS.config ? 'Saving…' : 'Clearing…');
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

    void mutate(API_PATHS.config, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ repository: value, scope }),
    }, (result) => result.source !== result.savedScope
      ? 'Saved in the ' + result.savedScope + ' config. The ' + result.source + ' setting is still active.'
      : 'Saved in the ' + result.savedScope + ' config.');
  }

  function clearSettings() {
    void mutate(API_PATHS.config + '?scope=' + scope, { method: 'DELETE' }, (result) => result.source !== 'none' && result.source !== result.clearedScope
      ? 'Cleared the ' + result.clearedScope + ' config. The ' + result.source + ' setting is still active.'
      : 'Cleared the ' + result.clearedScope + ' config.');
  }

  function updateHarness(value: Harness, checked: boolean) {
    const next = checked ? [...harnesses, value] : harnesses.filter((harness) => harness !== value);
    if (next.length === 0) return;
    setHarnesses(next);
    persistHarnessDefaults(next);
  }

  return (
    <DrawerShell
      id={DRAWER_TOGGLES.settings}
      title="Settings"
      onOpen={() => { closeDrawers(DRAWER_TOGGLES.changeDeck, DRAWER_TOGGLES.publish); void loadSettings(); }}
    >
      <div className="min-h-0 flex-1 divide-y divide-base-300">
        <Section
          id="settings-registry-title"
          title="Registry connection"
          trailing={<span className="badge badge-ghost">{source}</span>}
        >
          <form className="space-y-6" onSubmit={saveSettings}>
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
        </Section>

        <Section id="settings-harnesses-title" title="Default harnesses">
          <p className="text-sm text-base-content/60">Used as the initial selection for new install requests. Existing changes keep their own targets.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {harnessOptions.map((option) => (
              <label className="label cursor-pointer justify-start gap-2 rounded-box border border-base-300 px-3 py-3 has-checked:border-primary has-checked:bg-primary/10" key={option.value}>
                <input className="checkbox checkbox-primary" type="checkbox" value={option.value} checked={harnesses.includes(option.value)} onChange={(event) => updateHarness(option.value, event.currentTarget.checked)} disabled={busy} />
                {option.label}
              </label>
            ))}
          </div>
        </Section>

        <Section id="settings-appearance-title" title="Appearance">
          <ThemeSelector />
        </Section>
      </div>
    </DrawerShell>
  );
}
