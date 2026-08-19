import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import type { ResourceSummary } from '@ai-directory/contracts';
import { closeDrawers, errorMessage, request } from './api';
import {
  API_PATHS,
  appliedChangesMessage,
  DRAWER_TOGGLES,
  HARNESS_DEFAULTS_EVENT,
  JSON_HEADERS,
  persistStagedChanges,
  readHarnessDefaults,
  readStagedChanges,
  STAGE_RESOURCE_EVENT,
  UNSTAGE_RESOURCE_EVENT,
} from './lib';
import {
  ChangeDeckContext,
  type ActionMap,
  type ChangeDeckContextValue,
  type StagedItem,
  type StagedItemUpdate,
  type StagedMap,
} from './ChangeDeckContext';
import DrawerShell from './DrawerShell';
import InstalledResources from './InstalledResources';
import PlanView from './PlanView';
import ResourceCatalog from './ResourceCatalog';
import { useMountEffect } from './useMountEffect';
import {
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
  hideCatalog?: boolean;
  children?: ComponentChildren;
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
      harnesses: item.harnesses.length > 0 ? item.harnesses : nextHarnesses,
    };
    if (item.type === 'mcp-servers') operation.scope = item.scope ?? nextScope;
    return operation;
  });
}

function groupItems(items: StagedItem[]) {
  const mcp: StagedItem[] = [];
  const files: StagedItem[] = [];
  for (const item of items) {
    if (item.type === 'mcp-servers') mcp.push(item);
    else files.push(item);
  }
  return { mcp, files };
}

function mergePlans(plans: ChangePlan[]): ChangePlan {
  return {
    changes: plans.flatMap((plan) => plan.changes),
    conflicts: [...new Set(plans.flatMap((plan) => plan.conflicts))],
    warnings: [...new Set(plans.flatMap((plan) => plan.warnings))],
    projectionNotes: [...new Set(plans.flatMap((plan) => plan.projectionNotes))],
    fingerprint: '',
    operations: plans.flatMap((plan) => plan.operations ?? []),
  };
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
  hideCatalog = false,
  children,
}: ChangeDeckProviderProps) {
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [localResources, setLocalResources] = useState<LocalResource[]>([]);
  const [localRegistryError, setLocalRegistryError] = useState<string | undefined>(undefined);
  const [localLoading, setLocalLoading] = useState(false);
  const [staged, setStaged] = useState<StagedMap>({});
  const [harnesses, setHarnesses] = useState<Harness[]>(() => readHarnessDefaults());
  const [scope, setScope] = useState<InstallScope>('user');
  const [plan, setPlan] = useState<ChangePlan | null>(null);
  const [planFingerprints, setPlanFingerprints] = useState<Record<string, string>>({});
  const [planLoading, setPlanLoading] = useState(false);
  const [planStatus, setPlanStatus] = useState('');
  const [planError, setPlanError] = useState(false);
  const [force, setForce] = useState(false);
  const [applied, setApplied] = useState(false);
  const [busy, setBusy] = useState(false);
  const stagedRef = useRef<StagedMap>({});
  const harnessesRef = useRef<Harness[]>(['claude-code']);
  const scopeRef = useRef<InstallScope>('user');
  const requestId = useRef(0);
  const planTimer = useRef(0);

  stagedRef.current = staged;
  harnessesRef.current = harnesses;
  scopeRef.current = scope;

  const stagedItems = Object.values(staged);
  const mcpStaged = stagedItems.some((item) => item.type === 'mcp-servers');
  const canApply = Boolean(
    plan && plan.changes.length > 0 && (plan.conflicts.length === 0 || force) && !applied,
  );

  async function loadInstallations() {
    try {
      const result = await request<{ installations?: Installation[] }>(apiUrl, API_PATHS.installed);
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
        API_PATHS.localResources,
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
      setPlanFingerprints({});
      setPlanStatus('');
      return;
    }

    const currentRequest = ++requestId.current;
    const groups = groupItems(items);
    const groupRequests = [
      { name: 'mcp', items: groups.mcp },
      { name: 'files', items: groups.files },
    ].filter((group) => group.items.length > 0);
    setForce(false);
    setApplied(false);
    setPlanError(false);
    setPlanLoading(true);
    setPlanStatus('Updating preview…');

    try {
      const plans: ChangePlan[] = [];
      const fingerprints: Record<string, string> = {};
      for (const group of groupRequests) {
        const operations = operationsFor(group.items, nextHarnesses, nextScope);
        const result = await request<ChangePlan>(apiUrl, API_PATHS.plan, {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ operations }),
        });
        if (currentRequest !== requestId.current) return;
        fingerprints[group.name] = result.fingerprint;
        plans.push(result);
      }
      setPlan(mergePlans(plans));
      setPlanFingerprints(fingerprints);
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
    if (item.harnesses.length === 0) return;
    const normalized: StagedItem = { ...item, harnesses: [...item.harnesses] };
    if (normalized.type === 'mcp-servers' && !normalized.scope) normalized.scope = scopeRef.current;
    const next = { ...stagedRef.current, [normalized.key]: normalized };
    setStaged(next);
    stagedRef.current = next;
    persistStagedChanges(next);
    schedulePlan(next, harnessesRef.current, scopeRef.current);
  }

  function updateStagedItem(key: string, update: StagedItemUpdate) {
    const current = stagedRef.current[key];
    if (!current) return;
    const nextHarnesses = update.harnesses ?? current.harnesses;
    if (nextHarnesses.length === 0) return;
    const nextItem: StagedItem = {
      ...current,
      harnesses: [...new Set(nextHarnesses)],
    };
    if (current.type === 'mcp-servers' && update.scope) nextItem.scope = update.scope;
    const next = { ...stagedRef.current, [key]: nextItem };
    setStaged(next);
    stagedRef.current = next;
    persistStagedChanges(next);
    schedulePlan(next, harnessesRef.current, scopeRef.current);
  }

  function unstage(key: string) {
    const next = removeStagedKey(stagedRef.current, key);
    setStaged(next);
    stagedRef.current = next;
    persistStagedChanges(next);
    schedulePlan(next, harnessesRef.current, scopeRef.current);
  }

  function unstageResource(resource: string) {
    let next: StagedMap = {};
    for (const item of Object.values(stagedRef.current)) {
      if (item.resource !== resource) next[item.key] = item;
    }
    setStaged(next);
    stagedRef.current = next;
    persistStagedChanges(next);
    schedulePlan(next, harnessesRef.current, scopeRef.current);
  }

  function clear() {
    clearTimeout(planTimer.current);
    setStaged({});
    stagedRef.current = {};
    persistStagedChanges({});
    setPlan(null);
    setPlanFingerprints({});
    setPlanStatus('');
    setApplied(false);
  }

  function updateScope(nextScope: InstallScope) {
    setScope(nextScope);
    scopeRef.current = nextScope;
  }

  useMountEffect(() => {
    const restored = readStagedChanges();
    if (Object.keys(restored).length > 0) {
      setStaged(restored);
      stagedRef.current = restored;
      schedulePlan(restored, harnessesRef.current, scopeRef.current);
    }

    const handleStage = (event: Event) => {
      // SAFETY: InstallResource dispatches this event with a StagedItem detail.
      const item = (event as CustomEvent<StagedItem>).detail;
      if (item && Array.isArray(item.harnesses)) stage(item);
    };
    const handleUnstage = (event: Event) => {
      // SAFETY: InstallResource dispatches this event with a key detail object.
      const detail = (event as CustomEvent<{ key: string }>).detail;
      if (detail?.key) unstage(detail.key);
    };
    const handleHarnessDefaults = (event: Event) => {
      // SAFETY: persistHarnessDefaults dispatches this event with a Harness[] detail.
      const defaults = (event as CustomEvent<Harness[]>).detail;
      if (!Array.isArray(defaults) || defaults.length === 0) return;
      setHarnesses(defaults);
      harnessesRef.current = defaults;
    };
    window.addEventListener(STAGE_RESOURCE_EVENT, handleStage);
    window.addEventListener(UNSTAGE_RESOURCE_EVENT, handleUnstage);
    window.addEventListener(HARNESS_DEFAULTS_EVENT, handleHarnessDefaults);
    return () => {
      window.removeEventListener(STAGE_RESOURCE_EVENT, handleStage);
      window.removeEventListener(UNSTAGE_RESOURCE_EVENT, handleUnstage);
      window.removeEventListener(HARNESS_DEFAULTS_EVENT, handleHarnessDefaults);
    };
  });

  async function applyChanges() {
    if (!plan || !canApply) return;
    setBusy(true);
    setPlanError(false);
    setPlanStatus('Applying all changes…');
    const groups = groupItems(stagedItems);
    const groupRequests = [
      { name: 'mcp', items: groups.mcp },
      { name: 'files', items: groups.files },
    ].filter((group) => group.items.length > 0);
    try {
      let appliedChanges = 0;
      const warnings: string[] = [];
      for (const [index, group] of groupRequests.entries()) {
        const operations = operationsFor(group.items, harnesses, scope);
        let fingerprint = planFingerprints[group.name];
        if (index > 0) {
          const fresh = await request<ChangePlan>(apiUrl, API_PATHS.plan, {
            method: 'POST',
            headers: JSON_HEADERS,
            body: JSON.stringify({ operations }),
          });
          fingerprint = fresh.fingerprint;
        }
        const result = await request<{ plan: ChangePlan; warnings?: string[] }>(apiUrl, API_PATHS.apply, {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ operations, force, planFingerprint: fingerprint }),
        });
        appliedChanges += result.plan.changes.length;
        warnings.push(...(result.warnings ?? []));
      }
      setApplied(true);
      setPlanError(false);
      setStaged({});
      stagedRef.current = {};
      persistStagedChanges({});
      setPlanFingerprints({});
      setPlanStatus(appliedChangesMessage(appliedChanges, warnings));
      void loadInstallations();
      void loadLocalResources();
    } catch (cause) {
      setPlanError(true);
      setPlanStatus(errorMessage(cause, 'Could not apply the change plan.'));
      schedulePlan(stagedRef.current, harnessesRef.current, scopeRef.current);
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
    updateStagedItem,
    unstage,
    unstageResource,
    clear,
    setForce,
    loadLocalResources,
    applyChanges,
  };

  return (
    <ChangeDeckContext.Provider value={value}>
      {hideCatalog ? children : <ResourceCatalog resources={resources} registryError={registryError} />}
      <InstalledResources homeDir={homeDir} />

      <DrawerShell
        id={DRAWER_TOGGLES.changeDeck}
        title="Changes"
        onOpen={() => closeDrawers(DRAWER_TOGGLES.installed, DRAWER_TOGGLES.settings, DRAWER_TOGGLES.publish)}
      >
        {stagedItems.length > 0 && (
          <div className="mb-5 flex items-center justify-between gap-3">
            <p className="text-sm text-base-content/60">Review the staged changes, then apply them.</p>
            <button className="btn btn-ghost btn-xs shrink-0" type="button" onClick={clear}>Discard changes</button>
          </div>
        )}

        {mcpStaged && (
          <fieldset className="fieldset shrink-0 border-b border-base-300 pb-5">
            <legend className="fieldset-legend">Default MCP scope</legend>
            <p className="text-xs text-base-content/60">Existing staged resources keep their own scope.</p>
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
            stagedItems={stagedItems}
            onRemove={(resource) => unstageResource(resource)}
            onUpdate={updateStagedItem}
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
