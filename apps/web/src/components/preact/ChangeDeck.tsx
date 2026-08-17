import { useRef, useState } from 'preact/hooks';
import type { ResourceSummary } from '@ai-directory/contracts';
import { closeDrawers, errorMessage, request } from './api';
import {
  ChangeDeckContext,
  type ActionMap,
  type ChangeDeckContextValue,
  type StagedItem,
  type StagedMap,
} from './ChangeDeckContext';
import DrawerShell from './DrawerShell';
import InstalledResources from './InstalledResources';
import PlanView from './PlanView';
import ResourceCatalog from './ResourceCatalog';
import { useMountEffect } from './useMountEffect';
import {
  harnessOptions,
  scopeOptions,
  type ChangeOperation,
  type ChangePlan,
  type Harness,
  type Installation,
  type InstallScope,
  type LocalResource,
} from './types';

type ChangeDeckProviderProps = {
  apiUrl: string;
  homeDir: string;
  resources: ResourceSummary[];
  registryError?: string | undefined;
};

function removeStagedKey(record: StagedMap, key: string) {
  const next: StagedMap = {};
  for (const [candidate, item] of Object.entries(record)) {
    if (candidate !== key) next[candidate] = item;
  }
  return next;
}

function operationsFor(
  items: StagedItem[],
  nextHarnesses: Harness[],
  nextScope: InstallScope,
): ChangeOperation[] {
  return items.map((item) => {
    const operation: ChangeOperation = {
      resource: item.resource,
      action: item.action,
      harnesses: item.harnesses ?? nextHarnesses,
    };
    if (item.type === 'mcp-servers') operation.scope = item.scope ?? nextScope;
    return operation;
  });
}

function stagedActions(items: StagedItem[]) {
  const actions: ActionMap = {};
  for (const item of items) actions[item.resource] = item.action;
  return actions;
}

export default function ChangeDeckProvider({
  apiUrl,
  homeDir,
  resources,
  registryError,
}: ChangeDeckProviderProps) {
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [localResources, setLocalResources] = useState<LocalResource[]>([]);
  const [localRegistryError, setLocalRegistryError] = useState<string | undefined>(undefined);
  const [localLoading, setLocalLoading] = useState(false);
  const [staged, setStaged] = useState<StagedMap>({});
  const [harnesses, setHarnesses] = useState<Harness[]>(['claude-code']);
  const [scope, setScope] = useState<InstallScope>('user');
  const [plan, setPlan] = useState<ChangePlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planStatus, setPlanStatus] = useState('');
  const [planError, setPlanError] = useState(false);
  const [force, setForce] = useState(false);
  const [applied, setApplied] = useState(false);
  const [busy, setBusy] = useState(false);
  const requestId = useRef(0);
  const planTimer = useRef(0);

  const stagedItems = Object.values(staged);
  const mcpStaged = stagedItems.some((item) => item.type === 'mcp-servers');
  const canApply = Boolean(
    plan && plan.changes.length > 0 && (plan.conflicts.length === 0 || force) && !applied,
  );

  async function loadInstallations() {
    try {
      const result = await request<{ installations?: Installation[] }>(apiUrl, '/api/installed');
      setInstallations(result.installations ?? []);
    } catch {
      setInstallations([]);
    }
  }

  async function loadLocalResources() {
    setLocalLoading(true);
    try {
      const result = await request<{ resources?: LocalResource[]; registryError?: string }>(
        apiUrl,
        '/api/local-resources',
      );
      setLocalResources(result.resources ?? []);
      setLocalRegistryError(result.registryError);
    } catch (cause) {
      setLocalResources([]);
      setLocalRegistryError(errorMessage(cause, 'Could not scan local resources.'));
    } finally {
      setLocalLoading(false);
    }
  }

  useMountEffect(() => {
    void loadInstallations();
    void loadLocalResources();
  });

  async function requestPlan(
    nextStaged: StagedMap,
    nextHarnesses: Harness[],
    nextScope: InstallScope,
  ) {
    const items = Object.values(nextStaged);
    if (items.length === 0 || nextHarnesses.length === 0) {
      setPlan(null);
      setPlanStatus('');
      return;
    }

    const currentRequest = ++requestId.current;
    const operations = operationsFor(items, nextHarnesses, nextScope);
    setForce(false);
    setApplied(false);
    setPlanError(false);
    setPlanLoading(true);
    setPlanStatus('Updating preview…');

    try {
      const result = await request<ChangePlan>(apiUrl, '/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operations }),
      });
      if (currentRequest !== requestId.current) return;
      setPlan(result);
      setPlanStatus('');
    } catch (cause) {
      if (currentRequest === requestId.current) {
        setPlanError(true);
        setPlanStatus(errorMessage(cause, 'Could not generate the change plan.'));
      }
    } finally {
      if (currentRequest === requestId.current) setPlanLoading(false);
    }
  }

  function schedulePlan(
    nextStaged: StagedMap,
    nextHarnesses: Harness[],
    nextScope: InstallScope,
  ) {
    clearTimeout(planTimer.current);
    planTimer.current = window.setTimeout(
      () => void requestPlan(nextStaged, nextHarnesses, nextScope),
      200,
    );
  }

  function stage(item: StagedItem) {
    const next = { ...staged, [item.key]: item };
    setStaged(next);
    schedulePlan(next, harnesses, scope);
  }

  function unstage(key: string) {
    const next = removeStagedKey(staged, key);
    setStaged(next);
    schedulePlan(next, harnesses, scope);
  }

  function unstageResource(resource: string) {
    let next: StagedMap = {};
    for (const item of Object.values(staged)) {
      if (item.resource !== resource) next[item.key] = item;
    }
    setStaged(next);
    schedulePlan(next, harnesses, scope);
  }

  function clear() {
    clearTimeout(planTimer.current);
    setStaged({});
    setPlan(null);
    setPlanStatus('');
    setApplied(false);
  }

  function updateHarness(value: Harness, checked: boolean) {
    const next = checked ? [...harnesses, value] : harnesses.filter((harness) => harness !== value);
    setHarnesses(next);
    schedulePlan(staged, next, scope);
  }

  function updateScope(nextScope: InstallScope) {
    setScope(nextScope);
    schedulePlan(staged, harnesses, nextScope);
  }

  async function applyChanges() {
    if (!plan || !canApply) return;
    setBusy(true);
    setPlanError(false);
    setPlanStatus('Applying all changes…');
    const operations = operationsFor(stagedItems, harnesses, scope);
    try {
      const result = await request<{ plan: ChangePlan; warnings?: string[] }>(apiUrl, '/api/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operations, force, planFingerprint: plan.fingerprint }),
      });
      setApplied(true);
      setPlanError(false);
      setStaged({});
      const warnings = result.warnings ?? [];
      setPlanStatus(
        'Applied ' + result.plan.changes.length + ' file change'
        + (result.plan.changes.length === 1 ? '' : 's') + '.'
        + (warnings.length ? '\n' + warnings.join('\n') : ''),
      );
      void loadInstallations();
      void loadLocalResources();
    } catch (cause) {
      setPlanError(true);
      setPlanStatus(errorMessage(cause, 'Could not apply the change plan.'));
    } finally {
      setBusy(false);
    }
  }

  const value: ChangeDeckContextValue = {
    installations,
    localResources,
    localRegistryError,
    localLoading,
    staged,
    harnesses,
    scope,
    plan,
    planLoading,
    planStatus,
    planError,
    force,
    busy,
    stage,
    unstage,
    unstageResource,
    clear,
    setHarnesses,
    setScope,
    setForce,
    loadLocalResources,
    applyChanges,
  };

  return (
    <ChangeDeckContext.Provider value={value}>
      <ResourceCatalog resources={resources} registryError={registryError} />
      <InstalledResources homeDir={homeDir} />

      <DrawerShell
        id="change-deck-toggle"
        title="Change deck"
        onOpen={() => closeDrawers('installed-drawer-toggle', 'settings-drawer-toggle', 'publish-drawer-toggle')}
      >
        {stagedItems.length > 0 && (
          <div className="mb-5 flex items-center justify-between gap-3">
            <p className="text-sm text-base-content/60">Review the staged changes, then apply them.</p>
            <button className="btn btn-ghost btn-xs shrink-0" type="button" onClick={clear}>Discard changes</button>
          </div>
        )}

        <fieldset className="fieldset shrink-0 border-b border-base-300 pb-5">
          <legend className="fieldset-legend">Harnesses</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {harnessOptions.map((option) => (
              <label className="label cursor-pointer justify-start gap-2" key={option.value}>
                <input className="checkbox checkbox-primary" type="checkbox" value={option.value} checked={harnesses.includes(option.value)} onChange={(event) => updateHarness(option.value, event.currentTarget.checked)} disabled={busy} />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>

        {mcpStaged && (
          <fieldset className="fieldset shrink-0 border-b border-base-300 pb-5">
            <legend className="fieldset-legend">MCP scope</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {scopeOptions.map((option) => (
                <label className="label cursor-pointer justify-start gap-2" key={option.value}>
                  <input className="radio radio-primary" type="radio" name="mcp-deck-scope" value={option.value} checked={scope === option.value} onChange={() => updateScope(option.value)} disabled={busy} />
                  <span>
                    {option.label}
                    <span className="block text-xs text-base-content/60">{option.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {plan ? (
          <PlanView
            plan={plan}
            showResource
            homeDir={homeDir}
            actions={stagedActions(stagedItems)}
            onRemove={(resource) => unstageResource(resource)}
            force={force}
            onForce={setForce}
            status={planStatus}
            statusError={planError}
            busy={busy || planLoading}
            onApply={() => void applyChanges()}
          />
        ) : stagedItems.length === 0 ? (
          <div className="alert alert-info mt-5 items-start text-sm">
            <i className="ph ph-info text-lg" aria-hidden="true"></i>
            <span>Select resources from the catalog or the installed panel to stage changes here.</span>
          </div>
        ) : (
          <div className="card card-border mt-5 bg-base-100" role="status" aria-live="polite">
            <div className="card-body gap-3 p-5">
              <span className="skeleton h-4 w-2/5"></span>
              <span className="skeleton h-4 w-4/5"></span>
              <span className="skeleton h-4 w-3/5"></span>
            </div>
          </div>
        )}
      </DrawerShell>
    </ChangeDeckContext.Provider>
  );
}
