import { useState } from 'preact/hooks';
import { useMountEffect } from './useMountEffect';
import PlanView from './PlanView';
import { errorMessage, request } from './api';
import {
  harnessOptions,
  scopeOptions,
  type Action,
  type ChangeOperation,
  type ChangePlan,
  type Harness,
  type Installation,
  type InstallScope,
} from './types';

type Props = {
  apiUrl: string;
  homeDir: string;
  resourceKey: string;
  resourceType: string;
  componentResources: string[];
  installBase: string;
};

type Intent = Action | 'update';

export default function InstallResource({
  apiUrl,
  homeDir,
  resourceKey,
  resourceType,
  componentResources,
  installBase,
}: Props) {
  const trackedResources = componentResources.length > 0 ? componentResources : [resourceKey];
  const isMcp = resourceType === 'mcp-servers';
  const [harnesses, setHarnesses] = useState<Harness[]>(['claude-code']);
  const [scope, setScope] = useState<InstallScope>('user');
  const [records, setRecords] = useState<Installation[]>([]);
  const [plan, setPlan] = useState<ChangePlan | null>(null);
  const [operations, setOperations] = useState<ChangeOperation[]>([]);
  const [status, setStatus] = useState(resourceType === 'templates' ? 'Ready to install.' : 'Checking local installations…');
  const [planStatus, setPlanStatus] = useState('');
  const [planError, setPlanError] = useState(false);
  const [error, setError] = useState(false);
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);

  useMountEffect(() => {
    if (resourceType !== 'templates') void loadInstallation(['claude-code'], scope);
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

  async function loadInstallation(nextHarnesses = harnesses, nextScope = scope) {
    if (nextHarnesses.length === 0) {
      updateInstallation([], nextHarnesses);
      return;
    }
    try {
      const result = await request<{ installations?: Installation[] }>(apiUrl, '/api/installed');
      // SAFETY: The installation manifest stores harness values from the known set.
      const nextRecords = (result.installations ?? []).filter(
        (item) => trackedResources.includes(item.resource)
          && nextHarnesses.includes(item.harness as Harness)
          && (!isMcp || item.scope === nextScope),
      );
      setHarnesses(nextHarnesses);
      updateInstallation(nextRecords, nextHarnesses);
    } catch (cause) {
      showStatus(errorMessage(cause, 'Could not reach the local API.'), true);
    }
  }

  function targetsFor(action: Intent) {
    if (action === 'install') return harnesses.filter((harness) => !completeInstallation(records, harness));
    return harnesses.filter((harness) => completeInstallation(records, harness));
  }

  async function reviewChanges(action: Intent) {
    setBusy(true);
    setPlanError(false);
    showStatus('Preparing change plan…');
    try {
      const targets = targetsFor(action);
      if (targets.length === 0) {
        showStatus(action === 'install' ? 'All selected harnesses are installed.' : 'No selected harness is installed.');
        return;
      }

      const nextOperation: ChangeOperation = {
        resource: resourceKey,
        harnesses: targets,
        action: action === 'uninstall' ? 'uninstall' : 'install',
      };
      if (isMcp) nextOperation.scope = scope;
      const nextOperations = [nextOperation];
      const result = await request<ChangePlan>(apiUrl, '/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operations: nextOperations }),
      });
      setOperations(nextOperations);
      setPlan(result);
      setForce(false);
      setPlanStatus(result.changes?.length
        ? 'Review the file changes, then apply them together.'
        : 'No changes are needed.');
      document.querySelector('[data-plan]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (cause) {
      setPlanError(true);
      showStatus(errorMessage(cause, 'The operation failed.'), true);
    } finally {
      setBusy(false);
    }
  }

  async function applyChanges() {
    if (!plan || operations.length === 0 || (plan.conflicts.length > 0 && !force)) return;
    setBusy(true);
    setPlanError(false);
    setPlanStatus('Applying all changes…');
    try {
      const result = await request<{ plan: ChangePlan; warnings?: string[] }>(apiUrl, '/api/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operations, force, planFingerprint: plan.fingerprint }),
      });
      await loadInstallation(harnesses, scope);
      setOperations([]);
      setPlanError(false);
      const warnings = result.warnings ?? [];
      setPlanStatus(
        'Applied ' + result.plan.changes.length + ' file change' + (result.plan.changes.length === 1 ? '' : 's') + '.'
        + (warnings.length ? '\n' + warnings.join('\n') : ''),
      );
    } catch (cause) {
      setPlanError(true);
      setPlanStatus(errorMessage(cause, 'Could not apply the change plan.'));
    } finally {
      setBusy(false);
    }
  }

  const installed = harnesses.filter((harness) => completeInstallation(records, harness));
  const missing = harnesses.filter((harness) => !completeInstallation(records, harness));
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
          <div className="grid gap-6">
            <fieldset className="fieldset">
              <legend className="fieldset-legend">Harnesses</legend>
              <div className="grid gap-3 sm:grid-cols-3">
                {harnessOptions.map((option) => (
                  <label className="label cursor-pointer justify-start gap-2" key={option.value}>
                    <input className="checkbox checkbox-primary" type="checkbox" value={option.value} checked={harnesses.includes(option.value)} onChange={(event) => { const next = event.currentTarget.checked ? [...harnesses, option.value] : harnesses.filter((harness) => harness !== option.value); setHarnesses(next); void loadInstallation(next); }} disabled={busy} />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>
            {isMcp && (
              <fieldset className="fieldset">
                <legend className="fieldset-legend">Scope</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {scopeOptions.map((option) => (
                    <label className="label cursor-pointer justify-start gap-2" key={option.value}>
                      <input className="radio radio-primary" type="radio" name="mcp-install-scope" value={option.value} checked={scope === option.value} onChange={() => { setScope(option.value); void loadInstallation(harnesses, option.value); }} disabled={busy} />
                      <span>
                        {option.label}
                        <span className="block text-xs text-base-content/60">{option.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            {missing.length > 0 && <button className="btn btn-primary" type="button" onClick={() => void reviewChanges('install')} disabled={busy}>Review install</button>}
            {installed.length > 0 && <button className="btn btn-outline" type="button" onClick={() => void reviewChanges('update')} disabled={busy}>Review update</button>}
            {installed.length > 0 && <button className="btn btn-outline" type="button" onClick={() => void reviewChanges('uninstall')} disabled={busy}>Review uninstall</button>}
          </div>
          <p className={'mt-4 text-sm ' + (error ? 'text-error' : 'text-base-content/60')} role="status">{status}</p>
        </div>
      </div>

      {plan && <PlanView plan={plan} title="Review before applying" onClose={() => setPlan(null)} homeDir={homeDir} force={force} onForce={setForce} status={planStatus} statusError={planError} busy={busy} onApply={() => void applyChanges()} />}

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-semibold text-base-content/60">CLI</p>
          <div className="mockup-code text-xs">
            <pre data-prefix="$"><code>{installBase}</code></pre>
          </div>
        </div>
      </div>
    </section>
  );
}
