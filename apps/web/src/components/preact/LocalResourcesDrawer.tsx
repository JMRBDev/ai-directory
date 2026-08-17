import { useState } from 'preact/hooks';
import DrawerShell from './DrawerShell';
import { closeDrawers, errorMessage, request } from './api';
import PlanView from './PlanView';
import { shortenHomePath } from './types';
import type { Action, ChangeOperation, ChangePlan, Harness, LocalResource } from './types';

type Props = {
  apiUrl: string;
  homeDir: string;
};

type HarnessFilter = 'all' | Harness;

const harnessLabels = {
  'claude-code': 'Claude Code',
  opencode: 'OpenCode',
  codex: 'Codex',
} satisfies Record<Harness, string>;

const typeLabels = {
  skills: 'Skill',
  agents: 'Agent',
  rules: 'Rule',
  'mcp-servers': 'MCP Server',
} satisfies Record<LocalResource['type'], string>;

function stateLabel(state: LocalResource['state']) {
  return state === 'managed'
    ? 'Managed'
    : state === 'modified'
      ? 'Modified'
      : state === 'missing'
        ? 'Missing'
        : 'Unmanaged';
}

function stateClass(state: LocalResource['state']) {
  return state === 'managed'
    ? 'badge-success'
    : state === 'modified' || state === 'missing'
      ? 'badge-warning'
      : 'badge-ghost';
}

function registryStateLabel(state: LocalResource['registryState']) {
  return state === 'current' ? 'Current' : state === 'outdated' ? 'Outdated' : 'Unknown';
}

function registryStateClass(state: LocalResource['registryState']) {
  return state === 'current'
    ? 'badge-success'
    : state === 'outdated'
      ? 'badge-warning'
      : 'badge-ghost';
}

function resourceLabel(resource: LocalResource) {
  return resource.resource ?? `local/${resource.type}/${resource.name}`;
}

function installActionLabel(resource: LocalResource) {
  return resource.state === 'missing' || resource.state === 'modified' ? 'Reinstall' : 'Update';
}

export default function LocalResourcesDrawer({ apiUrl, homeDir }: Props) {
  const [resources, setResources] = useState<LocalResource[]>([]);
  const [harness, setHarness] = useState<HarnessFilter>('all');
  const [status, setStatus] = useState('Open this panel to scan known harness locations.');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<ChangePlan | null>(null);
  const [operation, setOperation] = useState<ChangeOperation | null>(null);
  const [planning, setPlanning] = useState(false);
  const [planStatus, setPlanStatus] = useState('');
  const [planError, setPlanError] = useState(false);
  const [force, setForce] = useState(false);

  async function load() {
    setBusy(true);
    setError(false);

    try {
      const result = await request<{ resources?: LocalResource[]; registryError?: string }>(apiUrl, '/api/local-resources');
      const nextResources = result.resources ?? [];
      setResources(nextResources);
      setStatus(nextResources.length === 0
        ? 'No resources found in the known harness locations.'
        : `${nextResources.length} local resource${nextResources.length === 1 ? '' : 's'} found.${result.registryError ? ' Registry status is unavailable.' : ''}`);
    } catch (cause) {
      setError(true);
      setStatus(errorMessage(cause, 'Could not scan local resources.'));
    } finally {
      setBusy(false);
    }
  }

  async function planResource(resource: LocalResource, action: Action) {
    if (!resource.resource) return;

    const nextOperation: ChangeOperation = {
      resource: resource.resource,
      harnesses: [resource.harness],
      action,
    };
    if (resource.type === 'mcp-servers' && resource.scope) {
      nextOperation.scope = resource.scope;
    }
    const sameOperation = operation !== null
      && operation.resource === nextOperation.resource
      && operation.action === nextOperation.action
      && operation.harnesses.join(',') === nextOperation.harnesses.join(',');
    if (!sameOperation) setPlan(null);
    setPlanning(true);
    setBusy(true);
    setOperation(nextOperation);
    setForce(false);
    setPlanError(false);
    setPlanStatus('Preparing change preview…');

    try {
      const nextPlan = await request<ChangePlan>(apiUrl, '/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operations: [nextOperation] }),
      });
      setPlan(nextPlan);
      setPlanStatus('');
    } catch (cause) {
      setOperation(null);
      setPlanError(true);
      setPlanStatus(errorMessage(cause, 'Could not generate the change plan.'));
    } finally {
      setPlanning(false);
      setBusy(false);
    }
  }

  async function applyPlan() {
    if (!plan || !operation) return;
    const canApply = (plan.changes.length > 0 || operation.action === 'uninstall') && (plan.conflicts.length === 0 || force);
    if (!canApply) return;

    setBusy(true);
    setPlanError(false);
    setPlanStatus('Applying changes…');
    try {
      const result = await request<{ plan: ChangePlan }>(apiUrl, '/api/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operations: [operation], force, planFingerprint: plan.fingerprint }),
      });
      setPlan(null);
      setOperation(null);
      setForce(false);
      setPlanError(false);
      await load();
      setStatus(`${operation.action === 'uninstall' ? 'Uninstalled' : 'Installed'} ${operation.resource}. Applied ${result.plan.changes.length} file change${result.plan.changes.length === 1 ? '' : 's'}.`);
    } catch (cause) {
      setPlanError(true);
      setPlanStatus(errorMessage(cause, 'Could not apply the change plan.'));
    } finally {
      setBusy(false);
    }
  }

  const visibleResources = resources.filter((resource) =>
    harness === 'all' || resource.harness === harness,
  );

  return (
    <DrawerShell
      id="installed-drawer-toggle"
      title="Installed resources"
      onOpen={() => {
        closeDrawers('change-deck-toggle', 'settings-drawer-toggle', 'publish-drawer-toggle');
        void load();
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-xl text-sm text-base-content/60">
          Resources found in your global harness setup.
        </p>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => void load()} disabled={busy}>
          <i className="ph ph-arrow-clockwise" aria-hidden="true"></i>
          Refresh
        </button>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="fieldset">
          <span className="fieldset-legend">Harness</span>
          <select className="select w-full" value={harness} onChange={(event) => {
            // SAFETY: The select options are exactly the HarnessFilter values.
            setHarness(event.currentTarget.value as HarnessFilter);
          }}>
            <option value="all">All harnesses</option>
            <option value="claude-code">Claude Code</option>
            <option value="opencode">OpenCode</option>
            <option value="codex">Codex</option>
          </select>
        </label>
      </div>

      <p className={'mt-5 text-sm ' + (error ? 'text-error' : 'text-base-content/60')} role="status" aria-live="polite">
        {busy ? 'Scanning known harness locations…' : status}
      </p>

      {visibleResources.length > 0 ? (
        <ul className="list mt-4 gap-2" aria-label="Local resources">
          {visibleResources.map((resource) => (
            <li className="list-row list-col-wrap gap-3 bg-base-200" key={`${resource.harness}:${resource.path}`}>
              <div className="flex size-10 shrink-0 items-center justify-center rounded-box bg-base-300 text-lg text-base-content/60">
                <i className={'ph ' + (resource.type === 'skills' ? 'ph-lightning' : resource.type === 'agents' ? 'ph-user-circle-gear' : resource.type === 'mcp-servers' ? 'ph-plugs-connected' : 'ph-scroll')} aria-hidden="true"></i>
              </div>
              <div className="list-col-grow min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="break-all text-sm text-base-content">{resourceLabel(resource)}</strong>
                  <span className={'badge badge-sm ' + stateClass(resource.state)}>{stateLabel(resource.state)}</span>
                  {resource.resource && <span className={'badge badge-sm ' + registryStateClass(resource.registryState)}>{registryStateLabel(resource.registryState)}</span>}
                </div>
                <p className="mt-1 text-xs text-base-content/60">
                  {typeLabels[resource.type]} · {harnessLabels[resource.harness]}
                  {resource.version ? ` · v${resource.version}` : ''}
                  {resource.latestVersion && resource.latestVersion !== resource.version ? ` · latest v${resource.latestVersion}` : ''}
                </p>
                <code className="mt-2 block truncate text-xs text-base-content/50" title={resource.path}>{shortenHomePath(resource.path, homeDir)}</code>
                {resource.resource ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(resource.registryState === 'outdated' || resource.state === 'missing' || resource.state === 'modified') && (
                      <button className="btn btn-primary btn-xs" type="button" onClick={() => void planResource(resource, 'install')} disabled={busy}>
                        <i className="ph ph-arrow-clockwise" aria-hidden="true"></i>
                        {installActionLabel(resource)}
                      </button>
                    )}
                    <button className="btn btn-ghost btn-xs text-error" type="button" onClick={() => void planResource(resource, 'uninstall')} disabled={busy}>
                      <i className="ph ph-trash" aria-hidden="true"></i>
                      Uninstall
                    </button>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-base-content/50">Unmanaged local resource</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : resources.length > 0 ? (
        <div className="alert alert-info mt-4 items-start text-sm">
          <i className="ph ph-funnel" aria-hidden="true"></i>
          <span>No local resources match these filters.</span>
        </div>
      ) : null}

      {plan ? (
        <PlanView
          plan={plan}
          showResource
          homeDir={homeDir}
          title="Review change"
          force={force}
          onForce={setForce}
          status={planStatus}
          statusError={planError}
          busy={busy || planning}
          onApply={() => void applyPlan()}
          onClose={() => {
            setPlan(null);
            setOperation(null);
            setForce(false);
          }}
        />
      ) : planning ? (
        <div className="card card-border mt-5 bg-base-100" role="status" aria-live="polite">
          <div className="card-body gap-3 p-5">
            <span className="skeleton h-4 w-2/5"></span>
            <span className="skeleton h-4 w-4/5"></span>
            <span className="skeleton h-4 w-3/5"></span>
          </div>
        </div>
      ) : null}
    </DrawerShell>
  );
}
