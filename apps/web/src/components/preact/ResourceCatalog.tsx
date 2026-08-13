import { useRef, useState } from 'preact/hooks';
import type { ResourceSummary } from '@ai-directory/contracts';
import PlanView from './PlanView';
import { closeDrawers, errorMessage, request } from './api';
import DrawerShell from './DrawerShell';
import { harnessOptions, resourceId, type Action, type ChangePlan, type Harness, type Scope } from './types';

type Props = {
  resources: ResourceSummary[];
  apiUrl: string;
  registryError?: string | undefined;
  source: string;
};

function detailPath(resource: ResourceSummary) {
  return ['/resources', resource.owner, resource.type, resource.name, ''].join('/');
}

function CatalogCard({
  resource,
  selected,
  onSelect,
}: {
  resource: ResourceSummary;
  selected: boolean;
  onSelect: (checked: boolean) => void;
}) {
  const id = resourceId(resource);
  const reviewed = resource.reviewStatus === 'reviewed';

  return (
    <article
      className="card card-border bg-base-100"
      data-resource
      data-type={resource.type}
      data-resource-id={id}
      data-search={[id, resource.description].join(' ').toLowerCase()}
    >
      <div className="card-body gap-3 p-5">
        <div className="flex items-center justify-between gap-3 text-xs">
          <label className="label cursor-pointer justify-start gap-2 p-0 text-base-content/60">
            <input
              className="checkbox checkbox-sm"
              type="checkbox"
              checked={selected}
              aria-label={'Select ' + resource.name}
              onChange={(event) => onSelect(event.currentTarget.checked)}
            />
            <span className="font-semibold uppercase tracking-[0.12em] text-primary">{resource.type}</span>
          </label>
          <span className={'badge ' + (reviewed ? 'badge-success' : 'badge-warning')}>
            {reviewed ? 'Reviewed' : 'Unreviewed'}
          </span>
        </div>
        <h3 className="card-title text-lg">
          <a className="link link-hover" href={detailPath(resource)}>{resource.name}</a>
        </h3>
        <p className="line-clamp-2 text-sm leading-6 text-base-content/60">{resource.description}</p>
        <div className="card-actions mt-1 items-center justify-between text-xs text-base-content/60">
          <span>{resource.owner} · v{resource.latestVersion}</span>
          <a className="btn btn-ghost btn-xs" href={detailPath(resource)}>View</a>
        </div>
      </div>
    </article>
  );
}

export default function ResourceCatalog({ resources, apiUrl, registryError, source }: Props) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [selected, setSelected] = useState<Record<string, Action>>({});
  const [harnesses, setHarnesses] = useState<Harness[]>(['claude-code']);
  const [scope, setScope] = useState<Scope>('project');
  const [plan, setPlan] = useState<ChangePlan | null>(null);
  const [planStatus, setPlanStatus] = useState('');
  const [force, setForce] = useState(false);
  const [applied, setApplied] = useState(false);
  const [busy, setBusy] = useState(false);
  const requestId = useRef(0);

  const visibleResources = resources.filter((resource) => {
    const matchesQuery = [resourceId(resource), resource.description]
      .join(' ')
      .toLowerCase()
      .includes(query.trim().toLowerCase());
    return matchesQuery && (type === 'all' || resource.type === type);
  });
  const selectedResources = resources.filter((resource) => selected[resourceId(resource)]);
  const canApply = Boolean(plan && plan.changes.length > 0 && (plan.conflicts.length === 0 || force) && !applied);

  function setHeaderCount(value: number) {
    const counter = document.querySelector<HTMLElement>('[data-deck-count]');
    if (counter) counter.textContent = String(value);
  }

  async function requestPlan(
    nextSelected = selected,
    nextHarnesses = harnesses,
    nextScope = scope,
  ) {
    const nextResources = resources.filter((resource) => nextSelected[resourceId(resource)]);
    if (nextResources.length === 0) {
      setPlan(null);
      setPlanStatus('Select a resource to generate a preview.');
      return;
    }
    if (nextHarnesses.length === 0) {
      setPlan(null);
      setPlanStatus('Select at least one harness.');
      return;
    }

    const currentRequest = ++requestId.current;
    const operations = nextResources.map((resource) => ({
      resource: resourceId(resource),
      action: nextSelected[resourceId(resource)] ?? 'install',
      harnesses: nextHarnesses,
      scope: nextScope,
    }));
    setPlan(null);
    setForce(false);
    setApplied(false);
    setPlanStatus('Updating preview…');

    try {
      const result = await request<ChangePlan>(apiUrl, '/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operations }),
      });
      if (currentRequest !== requestId.current) return;
      setPlan(result);
      setPlanStatus(result.changes.length === 0
        ? 'No changes are needed.'
        : result.changes.length + ' file' + (result.changes.length === 1 ? '' : 's') + ' ready to apply.');
    } catch (cause) {
      if (currentRequest === requestId.current) setPlanStatus(errorMessage(cause, 'Could not generate the change plan.'));
    }
  }

  function selectResource(resource: ResourceSummary, checked: boolean) {
    const id = resourceId(resource);
    const nextSelected = checked
      ? { ...selected, [id]: selected[id] ?? 'install' }
      : Object.fromEntries(Object.entries(selected).filter(([key]) => key !== id));
    setSelected(nextSelected);
    setHeaderCount(Object.keys(nextSelected).length);
    void requestPlan(nextSelected);
  }

  function updateAction(id: string, action: Action) {
    const nextSelected = { ...selected, [id]: action };
    setSelected(nextSelected);
    void requestPlan(nextSelected);
  }

  function updateHarness(value: Harness, checked: boolean) {
    const nextHarnesses = checked
      ? [...harnesses, value]
      : harnesses.filter((harness) => harness !== value);
    setHarnesses(nextHarnesses);
    void requestPlan(selected, nextHarnesses);
  }

  function clearSelection() {
    setSelected({});
    setHeaderCount(0);
    setPlan(null);
    setPlanStatus('Select a resource to generate a preview.');
  }

  async function applyPlan() {
    if (!plan || !canApply) return;
    setBusy(true);
    setPlanStatus('Applying all changes…');
    const operations = selectedResources.map((resource) => ({
      resource: resourceId(resource),
      action: selected[resourceId(resource)] ?? 'install',
      harnesses,
      scope,
    }));
    try {
      const result = await request<{ plan: ChangePlan }>(apiUrl, '/api/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operations, force }),
      });
      setApplied(true);
      setPlanStatus('Applied ' + result.plan.changes.length + ' file changes.');
    } catch (cause) {
      setPlanStatus(errorMessage(cause, 'Could not apply the change plan.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section id="catalog" className="mt-14" aria-labelledby="catalog-title">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-base-300 pb-5">
          <h2 id="catalog-title" className="text-xl font-semibold tracking-tight text-base-content">Available resources</h2>
          <p className="text-xs text-base-content/60">
            Source: {source === 'remote' ? 'configured Git registry' : 'explicit local index'}
          </p>
        </div>

        {registryError ? (
          <div className="alert alert-error mt-6 items-start text-sm" role="alert">
            <i className="ph ph-warning-circle text-xl" aria-hidden="true"></i>
            <div>
              <strong className="font-semibold">Could not load the registry.</strong>
              <p className="mt-2">{registryError}</p>
              <p className="mt-2">Run <kbd className="kbd kbd-sm font-mono">aid setup</kbd> or pass <kbd className="kbd kbd-sm font-mono">--index &lt;path&gt;</kbd>.</p>
            </div>
          </div>
        ) : resources.length === 0 ? (
          <div className="card card-border mt-6 bg-base-100">
            <div className="card-body p-6">
              <strong className="font-semibold text-base-content">No active resources yet.</strong>
              <p className="mt-2 text-sm text-base-content/60">Submit the first resource with the CLI, then refresh the registry.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="card card-border mt-6 bg-base-100" role="search">
              <div className="card-body grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end">
                <label className="fieldset">
                  <span className="fieldset-legend">Search</span>
                  <input className="input input-bordered w-full" type="search" placeholder="Name, owner, or description" value={query} onInput={(event) => setQuery(event.currentTarget.value)} />
                </label>
                <label className="fieldset">
                  <span className="fieldset-legend">Type</span>
                  <select className="select select-bordered w-full" value={type} onChange={(event) => setType(event.currentTarget.value)}>
                    <option value="all">All types</option>
                    <option value="skills">Skills</option>
                    <option value="agents">Agents</option>
                    <option value="rules">Rules</option>
                    <option value="templates">Templates</option>
                  </select>
                </label>
                <p className="pb-2 text-xs text-base-content/60" aria-live="polite">{visibleResources.length} result{visibleResources.length === 1 ? '' : 's'}</p>
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {visibleResources.map((resource) => (
                <CatalogCard
                  key={resourceId(resource)}
                  resource={resource}
                  selected={Boolean(selected[resourceId(resource)])}
                  onSelect={(checked) => selectResource(resource, checked)}
                />
              ))}
            </div>
            {visibleResources.length === 0 && (
              <div className="card card-border mt-6 bg-base-100">
                <div className="card-body p-6">
                  <strong className="font-semibold text-base-content">No matching resources.</strong>
                  <p className="mt-2 text-sm text-base-content/60">Change the search text or select a different resource type.</p>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <DrawerShell
        id="change-deck-toggle"
        title="Change deck"
        onOpen={() => closeDrawers('settings-drawer-toggle', 'publish-drawer-toggle')}
      >
        <p className="mb-5 text-sm text-base-content/60">
          {selectedResources.length === 0 ? 'No pending changes.' : selectedResources.length + ' resource' + (selectedResources.length === 1 ? '' : 's') + ' staged. Review the file changes before saving.'}
        </p>

        <section className="shrink-0 border-b border-base-300 py-5" aria-labelledby="deck-selection-title">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 id="deck-selection-title" className="text-sm font-semibold text-base-content">Selected resources</h3>
              <p className="mt-1 text-xs text-base-content/60">{selectedResources.length} resource{selectedResources.length === 1 ? '' : 's'} selected</p>
            </div>
            <button className="btn btn-ghost btn-xs" type="button" onClick={clearSelection}>Discard changes</button>
          </div>
          {selectedResources.length > 0 ? (
            <ul className="list list-sm mt-4">
              {selectedResources.map((resource) => {
                const id = resourceId(resource);
                return (
                  <li className="list-row list-col-wrap grid-cols-1 gap-2 bg-base-200" key={id}>
                    <div className="list-col-grow flex flex-col gap-2">
                      <div className="flex items-start justify-between gap-3">
                        <span className="break-all font-mono text-xs text-base-content">{id}</span>
                        <button className="btn btn-ghost btn-xs shrink-0" type="button" onClick={() => selectResource(resource, false)}>Remove</button>
                      </div>
                      <select className="select select-bordered select-sm w-full" value={selected[id] ?? 'install'} aria-label={'Action for ' + id} onChange={(event) => updateAction(id, event.currentTarget.value as Action)}>
                        <option value="install">Install or update</option>
                        <option value="uninstall">Uninstall</option>
                      </select>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="alert alert-info mt-4 items-start text-sm">
              <i className="ph ph-info text-lg" aria-hidden="true"></i>
              <span>Select resources from the catalog to stage changes here.</span>
            </div>
          )}
        </section>

        <div className="mt-5 grid shrink-0 gap-5 border-b border-base-300 pb-5">
          <fieldset className="fieldset">
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
          <label className="fieldset">
            <span className="fieldset-legend">Scope</span>
            <select className="select select-bordered w-full" value={scope} onChange={(event) => { const nextScope = event.currentTarget.value as Scope; setScope(nextScope); void requestPlan(selected, harnesses, nextScope); }} disabled={busy}>
              <option value="project">This project</option>
              <option value="global">All projects</option>
            </select>
          </label>
          <button className="btn btn-ghost btn-sm justify-self-start text-primary" type="button" onClick={() => void requestPlan()} disabled={busy}>Refresh preview</button>
        </div>

        {plan && <PlanView plan={plan} showResource force={force} onForce={setForce} status={planStatus} busy={busy} onApply={() => void applyPlan()} />}
      </DrawerShell>
    </>
  );
}
