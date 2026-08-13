import { useRef, useState } from 'preact/hooks';
import type { ResourceSummary, ResourceType } from '@ai-directory/contracts';
import PlanView from './PlanView';
import { closeDrawers, errorMessage, request } from './api';
import DrawerShell from './DrawerShell';
import { harnessOptions, resourceId, type Action, type ChangePlan, type Harness, type Scope } from './types';

type Props = {
  resources: ResourceSummary[];
  apiUrl: string;
  registryError?: string | undefined;
};

type ReviewFilter = 'all' | 'reviewed' | 'unreviewed';
type SortOption = 'updated' | 'name' | 'version';

const PAGE_SIZE = 6;
const RESOURCE_TYPES: Array<{ value: ResourceType; label: string }> = [
  { value: 'skills', label: 'Skills' },
  { value: 'agents', label: 'Agents' },
  { value: 'rules', label: 'Rules' },
  { value: 'templates', label: 'Templates' },
];

function resourceTypeLabel(type: ResourceType) {
  return RESOURCE_TYPES.find((option) => option.value === type)?.label ?? type;
}

function detailPath(resource: ResourceSummary) {
  return ['/resources', resource.owner, resource.type, resource.name, ''].join('/');
}

function updatedLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
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
      className={'card card-border relative transition-colors hover:border-primary ' + (selected ? 'border-primary bg-primary/5' : 'bg-base-100')}
      data-resource
      data-type={resource.type}
      data-resource-id={id}
      data-search={[id, resource.description].join(' ').toLowerCase()}
    >
      <button
        className="absolute inset-0 cursor-pointer appearance-none border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-primary"
        type="button"
        aria-label={(selected ? 'Unselect ' : 'Select ') + id}
        aria-pressed={selected}
        onClick={() => onSelect(!selected)}
      ></button>
      <div className="card-body pointer-events-none relative gap-4 p-5">
        <div>
          <div className="flex items-center justify-between gap-3">
            <h3 className="card-title min-w-0 flex-1 text-lg">
              <a className="pointer-events-auto block truncate link link-hover" href={detailPath(resource)}>{resource.name}</a>
            </h3>
            <span className={'badge badge-sm shrink-0 ' + (reviewed ? 'badge-success' : 'badge-warning')}>
              {reviewed ? 'Reviewed' : 'Unreviewed'}
            </span>
          </div>
          <p className="mt-2 line-clamp-3 text-sm leading-6 text-base-content/65">{resource.description}</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-base-300 text-xs text-base-content/60 pt-3">
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <span>{resource.owner}</span>
            <span>v{resource.latestVersion}</span>
          </div>
          <span>Updated {updatedLabel(resource.updatedAt)}</span>
        </div>
      </div>
    </article>
  );
}

export default function ResourceCatalog({ resources, apiUrl, registryError }: Props) {
  const [query, setQuery] = useState('');
  const [activeType, setActiveType] = useState<ResourceType>(resources[0]?.type ?? 'skills');
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all');
  const [sort, setSort] = useState<SortOption>('updated');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Record<string, Action>>({});
  const [harnesses, setHarnesses] = useState<Harness[]>(['claude-code']);
  const [scope, setScope] = useState<Scope>('project');
  const [plan, setPlan] = useState<ChangePlan | null>(null);
  const [planStatus, setPlanStatus] = useState('');
  const [planError, setPlanError] = useState(false);
  const [force, setForce] = useState(false);
  const [applied, setApplied] = useState(false);
  const [busy, setBusy] = useState(false);
  const requestId = useRef(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const activeTypeResources = resources.filter((resource) => resource.type === activeType);
  const filteredResources = activeTypeResources.filter((resource) => {
    const matchesQuery = [resourceId(resource), resource.description]
      .join(' ')
      .toLowerCase()
      .includes(query.trim().toLowerCase());
    const matchesReview = reviewFilter === 'all' || resource.reviewStatus === reviewFilter;
    return matchesQuery && matchesReview;
  });
  const sortedResources = [...filteredResources].sort((left, right) => {
    if (sort === 'name') return left.name.localeCompare(right.name);
    if (sort === 'version') return right.latestVersion.localeCompare(left.latestVersion, undefined, { numeric: true });
    return right.updatedAt.localeCompare(left.updatedAt);
  });
  const pageCount = Math.max(1, Math.ceil(sortedResources.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const visibleResources = sortedResources.slice(pageStart, pageStart + PAGE_SIZE);
  const selectedResources = resources.filter((resource) => selected[resourceId(resource)]);
  const canApply = Boolean(plan && plan.changes.length > 0 && (plan.conflicts.length === 0 || force) && !applied);
  const hasFilters = query.trim().length > 0 || reviewFilter !== 'all' || sort !== 'updated';
  const activeTypeLabel = resourceTypeLabel(activeType);

  function setHeaderCount(value: number) {
    const counter = document.querySelector<HTMLElement>('[data-deck-count]');
    if (counter) counter.textContent = String(value);
  }

  function changeType(nextType: ResourceType) {
    setActiveType(nextType);
    setPage(1);
  }

  function clearFilters() {
    setQuery('');
    setReviewFilter('all');
    setSort('updated');
    setPage(1);
  }

  function moveTab(event: KeyboardEvent, index: number) {
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    const nextIndex = (index + direction + RESOURCE_TYPES.length) % RESOURCE_TYPES.length;
    const nextOption = RESOURCE_TYPES[nextIndex];
    if (!nextOption) return;
    const nextType = nextOption.value;
    changeType(nextType);
    tabRefs.current[nextIndex]?.focus();
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
    setPlanError(false);
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
      if (currentRequest === requestId.current) {
        setPlanError(true);
        setPlanStatus(errorMessage(cause, 'Could not generate the change plan.'));
      }
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
    setPlanError(false);
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
        body: JSON.stringify({ operations, force, planFingerprint: plan.fingerprint }),
      });
      setApplied(true);
      setPlanError(false);
      setPlanStatus('Applied ' + result.plan.changes.length + ' file changes.');
    } catch (cause) {
      setPlanError(true);
      setPlanStatus(errorMessage(cause, 'Could not apply the change plan.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section id="catalog" className="mt-14" aria-labelledby="catalog-title">
        {registryError ? (
          <div className="alert alert-error items-start text-sm" role="alert">
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
            <div>
              <div className="tabs tabs-border w-full overflow-x-auto" role="tablist" aria-label="Resource types">
                {RESOURCE_TYPES.map((option, index) => {
                  const count = resources.filter((resource) => resource.type === option.value).length;
                  const active = activeType === option.value;
                  return (
                    <button
                      className={'tab min-w-fit gap-2 whitespace-nowrap ' + (active ? 'tab-active' : '')}
                      id={'resource-tab-' + option.value}
                      key={option.value}
                      type="button"
                      role="tab"
                      aria-label={option.label + ', ' + count + ' resource' + (count === 1 ? '' : 's')}
                      aria-selected={active}
                      aria-controls="resource-tabpanel"
                      tabIndex={active ? 0 : -1}
                      ref={(element) => { tabRefs.current[index] = element; }}
                      onClick={() => changeType(option.value)}
                      onKeyDown={(event) => moveTab(event, index)}
                    >
                      {option.label}
                      <span className="text-xs text-base-content/60">({count})</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div id="resource-tabpanel" className="mt-5" role="tabpanel" aria-labelledby={'resource-tab-' + activeType} tabIndex={0}>
              <div className="card card-border bg-base-100" role="search" aria-label={'Search ' + activeTypeLabel}>
                <div className="card-body gap-4 p-4 sm:p-5">
                  <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_11rem_13rem] md:items-end">
                    <label className="fieldset">
                      <span className="fieldset-legend">Search {activeTypeLabel.toLowerCase()}</span>
                      <input className="input w-full" type="search" placeholder="Name, owner, or description" value={query} onInput={(event) => { setQuery(event.currentTarget.value); setPage(1); }} />
                    </label>
                    <label className="fieldset">
                      <span className="fieldset-legend">Review status</span>
                      <select className="select w-full" value={reviewFilter} onChange={(event) => { setReviewFilter(event.currentTarget.value as ReviewFilter); setPage(1); }}>
                        <option value="all">All resources</option>
                        <option value="reviewed">Reviewed</option>
                        <option value="unreviewed">Unreviewed</option>
                      </select>
                    </label>
                    <label className="fieldset">
                      <span className="fieldset-legend">Sort by</span>
                      <select className="select w-full" value={sort} onChange={(event) => { setSort(event.currentTarget.value as SortOption); setPage(1); }}>
                        <option value="updated">Recently updated</option>
                        <option value="name">Name A-Z</option>
                        <option value="version">Newest version</option>
                      </select>
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-base-300 pt-3">
                    <p className="text-xs text-base-content/60" aria-live="polite">
                      {sortedResources.length === 0 ? 'No resources found' : 'Showing ' + (pageStart + 1) + '-' + Math.min(pageStart + PAGE_SIZE, sortedResources.length) + ' of ' + sortedResources.length}
                      {selectedResources.length > 0 && <><span aria-hidden="true"> </span><span className="ml-3 badge badge-primary badge-sm">{selectedResources.length} staged</span></>}
                    </p>
                    {hasFilters && <button className="btn btn-ghost btn-xs" type="button" onClick={clearFilters}>Clear filters</button>}
                  </div>
                </div>
              </div>

              {visibleResources.length > 0 ? (
                <>
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
                  {pageCount > 1 && (
                    <nav className="mt-6 flex flex-wrap items-center justify-between gap-4" aria-label={activeTypeLabel + ' pages'}>
                      <p className="text-xs text-base-content/60">Page {currentPage} of {pageCount}</p>
                      <div className="join">
                        <button className="btn btn-outline btn-sm join-item" type="button" onClick={() => setPage(Math.max(1, currentPage - 1))} disabled={currentPage === 1}>Previous</button>
                        <button className="btn btn-outline btn-sm join-item" type="button" onClick={() => setPage(Math.min(pageCount, currentPage + 1))} disabled={currentPage === pageCount}>Next</button>
                      </div>
                    </nav>
                  )}
                </>
              ) : (
                <div className="card card-border mt-5 bg-base-200/30">
                  <div className="card-body items-start p-6 sm:p-8">
                    <i className="ph ph-magnifying-glass text-2xl text-base-content/50" aria-hidden="true"></i>
                    <h3 className="mt-3 text-lg font-semibold text-base-content">
                      {activeTypeResources.length === 0 ? 'No ' + activeTypeLabel.toLowerCase() + ' yet' : 'No matching ' + activeTypeLabel.toLowerCase()}
                    </h3>
                    <p className="mt-2 max-w-xl text-sm leading-6 text-base-content/60">
                      {activeTypeResources.length === 0
                        ? 'Use Publish resource to add the first one to this registry.'
                        : 'Try a different search or review status.'}
                    </p>
                    {hasFilters && <button className="btn btn-ghost btn-sm mt-4" type="button" onClick={clearFilters}>Clear filters</button>}
                  </div>
                </div>
              )}
            </div>
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

        {plan && <PlanView plan={plan} showResource force={force} onForce={setForce} status={planStatus} statusError={planError} busy={busy} onApply={() => void applyPlan()} />}
      </DrawerShell>
    </>
  );
}
