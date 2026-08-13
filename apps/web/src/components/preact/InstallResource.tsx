import { useState } from 'preact/hooks';
import { useMountEffect } from './useMountEffect';
import ChangeRows from './ChangeRows';
import type { ChangePlan, Installation } from './types';

type Props = {
  apiUrl: string;
  resourceKey: string;
  resourceType: string;
  componentResources: string[];
  installBase: string;
};

type Harness = 'claude-code' | 'opencode' | 'codex';
type Scope = 'project' | 'global';
type Action = 'install' | 'update' | 'uninstall';

const harnessOptions: Array<{ value: Harness; label: string }> = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'codex', label: 'Codex' },
];

export default function InstallResource({
  apiUrl,
  resourceKey,
  resourceType,
  componentResources,
  installBase,
}: Props) {
  const trackedResources = componentResources.length > 0 ? componentResources : [resourceKey];
  const [harnesses, setHarnesses] = useState<Harness[]>(['claude-code']);
  const [scope, setScope] = useState<Scope>('project');
  const [records, setRecords] = useState<Installation[]>([]);
  const [plan, setPlan] = useState<ChangePlan | null>(null);
  const [operations, setOperations] = useState<Array<{ resource: string; harnesses: Harness[]; scope: Scope; action: 'install' | 'uninstall' }>>([]);
  const [status, setStatus] = useState(resourceType === 'templates' ? 'Ready to install.' : 'Checking local installations…');
  const [planStatus, setPlanStatus] = useState('');
  const [error, setError] = useState(false);
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);

  useMountEffect(() => {
    if (resourceType !== 'templates') void loadInstallation(['claude-code'], 'project');
  });

  function showStatus(message: string, isError = false) {
    setStatus(message);
    setError(isError);
  }

  function completeInstallation(items: Installation[], harness: Harness) {
    return trackedResources.every((resource) =>
      items.some((item) => item.resource === resource && item.harness === harness),
    );
  }

  function updateInstallation(nextRecords: Installation[], nextHarnesses = harnesses) {
    setRecords(nextRecords);
    const installed = nextHarnesses.filter((harness) => completeInstallation(nextRecords, harness));
    const missing = nextHarnesses.filter((harness) => !completeInstallation(nextRecords, harness));
    if (nextHarnesses.length === 0) {
      showStatus('Select at least one harness.');
    } else {
      const installedText = installed.length > 0 ? 'Installed for ' + installed.join(', ') : 'Not installed';
      const missingText = missing.length > 0 ? 'Not fully installed for ' + missing.join(', ') : '';
      showStatus([installedText, missingText].filter(Boolean).join('. ') + '.');
    }
  }

  async function request(path: string, init?: RequestInit) {
    const response = await fetch(apiUrl + path, init);
    const result = await response.json().catch(() => ({})) as Partial<ChangePlan> & { error?: string; installations?: Installation[] };
    if (!response.ok) throw new Error(result.error ?? 'The local API request failed.');
    return result;
  }

  async function loadInstallation(nextHarnesses = harnesses, nextScope = scope) {
    if (nextHarnesses.length === 0) {
      updateInstallation([], nextHarnesses);
      return;
    }
    try {
      const result = await request('/api/installed?scope=' + encodeURIComponent(nextScope));
      const nextRecords = (result.installations ?? []).filter(
        (item) => trackedResources.includes(item.resource)
          && nextHarnesses.includes(item.harness as Harness)
          && item.scope === nextScope,
      );
      setHarnesses(nextHarnesses);
      updateInstallation(nextRecords, nextHarnesses);
    } catch (cause) {
      showStatus(cause instanceof Error ? cause.message : 'Could not reach the local API.', true);
    }
  }

  function targetsFor(action: Action) {
    if (action === 'install') return harnesses.filter((harness) => !completeInstallation(records, harness));
    return harnesses.filter((harness) => completeInstallation(records, harness));
  }

  async function reviewChanges(action: Action) {
    setBusy(true);
    showStatus('Preparing change plan…');
    try {
      const targets = targetsFor(action);
      if (targets.length === 0) {
        showStatus(action === 'install' ? 'All selected harnesses are installed.' : 'No selected harness is installed.');
        return;
      }

      const nextOperations = [{
        resource: resourceKey,
        harnesses: targets,
        scope,
        action: action === 'uninstall' ? 'uninstall' as const : 'install' as const,
      }];
      const result = await request('/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operations: nextOperations }),
      });
      setOperations(nextOperations);
      setPlan(result as ChangePlan);
      setForce(false);
      setPlanStatus(result.changes?.length
        ? 'Review the file changes, then apply them together.'
        : 'No changes are needed.');
      document.querySelector('[data-detail-plan]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (cause) {
      showStatus(cause instanceof Error ? cause.message : 'The operation failed.', true);
    } finally {
      setBusy(false);
    }
  }

  async function applyChanges() {
    if (!plan || operations.length === 0 || (plan.conflicts.length > 0 && !force)) return;
    setBusy(true);
    setPlanStatus('Applying all changes…');
    try {
      const result = await request('/api/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operations, force }),
      });
      await loadInstallation(harnesses, scope);
      setOperations([]);
      setPlanStatus('Applied ' + (result.changes?.length ?? plan.changes.length) + ' file changes.');
    } catch (cause) {
      setPlanStatus(cause instanceof Error ? cause.message : 'Could not apply the change plan.');
    } finally {
      setBusy(false);
    }
  }

  const installed = harnesses.filter((harness) => completeInstallation(records, harness));
  const missing = harnesses.filter((harness) => !completeInstallation(records, harness));
  const canApply = Boolean(plan && plan.changes.length > 0 && (plan.conflicts.length === 0 || force));

  return (
    <section
      className="mt-14 w-full border-t border-base-300 pt-8"
      aria-labelledby="install-title"
      data-resource-install
      data-resource-id={resourceKey}
      data-resource-type={resourceType}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Install</p>
      <h2 id="install-title" className="mt-2 text-xl font-semibold tracking-tight text-base-content">Use this resource locally</h2>
      {resourceType === 'templates' && (
        <div className="alert alert-info mt-5 items-start text-sm leading-6" role="status">
          <i className="ph ph-package text-xl" aria-hidden="true"></i>
          <div>This template stages its component resources as one pack. Review the complete file change before applying it.</div>
        </div>
      )}

      <div className="card card-border mt-6 bg-base-100">
        <div className="card-body p-5">
          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_12rem]">
            <fieldset className="fieldset">
              <legend className="fieldset-legend">Harnesses</legend>
              <div className="grid gap-3 sm:grid-cols-3">
                {harnessOptions.map((option) => (
                  <label className="label cursor-pointer justify-start gap-2" key={option.value}>
                    <input className="checkbox checkbox-primary" type="checkbox" value={option.value} checked={harnesses.includes(option.value)} onChange={(event) => { const next = event.currentTarget.checked ? [...harnesses, option.value] : harnesses.filter((harness) => harness !== option.value); setHarnesses(next); void loadInstallation(next, scope); }} disabled={busy} />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="fieldset">
              <span className="fieldset-legend">Scope</span>
              <select className="select select-bordered w-full" value={scope} onChange={(event) => { const next = event.currentTarget.value as Scope; setScope(next); void loadInstallation(harnesses, next); }} disabled={busy}>
                <option value="project">This project</option>
                <option value="global">All projects</option>
              </select>
            </label>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            {missing.length > 0 && <button className="btn btn-primary" type="button" onClick={() => void reviewChanges('install')} disabled={busy}>Review install</button>}
            {installed.length > 0 && <button className="btn btn-outline" type="button" onClick={() => void reviewChanges('update')} disabled={busy}>Review update</button>}
            {installed.length > 0 && <button className="btn btn-outline" type="button" onClick={() => void reviewChanges('uninstall')} disabled={busy}>Review uninstall</button>}
          </div>
          <p className={'mt-4 text-sm ' + (error ? 'text-error' : 'text-base-content/60')} role="status">{status}</p>
        </div>
      </div>

      {plan && (
        <div className="card card-border mt-5 bg-base-100" data-detail-plan>
          <div className="card-body p-5">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-base-300 pb-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Change plan</p>
                <h3 className="mt-2 text-lg font-semibold tracking-tight text-base-content">Review before applying</h3>
              </div>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => setPlan(null)}>Close</button>
            </div>
            <div className="stats stats-vertical mt-4 w-full border-y border-base-300 sm:stats-horizontal">
              <div className="stat px-0 py-3 sm:pr-4"><div className="stat-value text-xl">{plan.changes.filter((change) => change.action === 'added').length}</div><div className="stat-title text-xs">Added</div></div>
              <div className="stat border-base-300 px-0 py-3 sm:border-l sm:px-4"><div className="stat-value text-xl">{plan.changes.filter((change) => change.action === 'modified').length}</div><div className="stat-title text-xs">Modified</div></div>
              <div className="stat border-base-300 px-0 py-3 sm:border-l sm:pl-4"><div className="stat-value text-xl">{plan.changes.filter((change) => change.action === 'removed').length}</div><div className="stat-title text-xs">Removed</div></div>
            </div>
            <div className="mt-4">
              {plan.changes.length > 0
                ? <ChangeRows changes={plan.changes} />
                : <div className="alert alert-info items-start text-sm"><i className="ph ph-info text-lg" aria-hidden="true"></i><span>No file changes are needed.</span></div>}
            </div>
            {plan.conflicts.length > 0 && (
              <div className="alert alert-warning mt-4 items-start text-sm" role="alert">
                <i className="ph ph-warning text-lg" aria-hidden="true"></i>
                <span>Review required: {plan.conflicts.join(' ')}</span>
              </div>
            )}
            {plan.warnings.length > 0 && <div className="alert alert-warning mt-4 items-start text-sm"><i className="ph ph-warning text-lg" aria-hidden="true"></i><span>Unreviewed resources: {plan.warnings.join(', ')}</span></div>}
            {plan.conflicts.length > 0 && (
              <label className="alert alert-warning mt-4 items-start gap-3 text-sm">
                <input className="checkbox checkbox-warning mt-0.5" type="checkbox" checked={force} onChange={(event) => setForce(event.currentTarget.checked)} />
                <span><strong className="font-semibold">Allow overwrite or removal of locally changed files</strong><span className="mt-1 block text-xs">Use this only after checking the affected files.</span></span>
              </label>
            )}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-base-content/60" role="status">{planStatus}</p>
              <button className="btn btn-primary" type="button" onClick={() => void applyChanges()} disabled={!canApply || busy}>Apply changes</button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {(['project', 'global'] as const).map((commandScope) => (
          <div key={commandScope}>
            <p className="mb-2 text-xs font-semibold text-base-content/60">{commandScope === 'project' ? 'Project scope' : 'Global scope'}</p>
            <div className="mockup-code text-xs">
              <pre data-prefix="$"><code>{installBase} --scope {commandScope}</code></pre>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
