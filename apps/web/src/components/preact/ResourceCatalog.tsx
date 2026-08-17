import { useRef, useState } from 'preact/hooks';
import type { ResourceSummary, ResourceType } from '@ai-directory/contracts';
import PlanView from './PlanView';
import { closeDrawers, errorMessage, request } from './api';
import DrawerShell from './DrawerShell';
import { useMountEffect } from './useMountEffect';
import { harnessOptions, resourceId, type Action, type ChangePlan, type Harness, type Installation } from './types';

type Props = {
  resources: ResourceSummary[];
  apiUrl: string;
  homeDir: string;
  registryError?: string | undefined;
};

type ReviewFilter = 'all' | 'reviewed' | 'unreviewed';
type InstalledFilter = 'all' | 'installed' | 'not-installed';
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
  installed,
  onSelect,
}: {
  resource: ResourceSummary;
  selected: boolean;
  installed: boolean;
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
            <span className="flex shrink-0 items-center gap-1">
              {installed && (
                <span className="badge badge-success badge-sm gap-1">
                  <i className="ph ph-check text-xs" aria-hidden="true"></i>
                  Installed
                </span>
              )}
              <span className={'badge badge-sm ' + (reviewed ? 'badge-success' : 'badge-warning')}>
                {reviewed ? 'Reviewed' : 'Unreviewed'}
              </span>
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

function removeSelectedKey(record: Record<string, Action>, key: string) {
  const next: typeof record = {};
  for (const [candidate, action] of Object.entries(record)) {
    if (candidate !== key) next[candidate] = action;
  }
  return next;
}

export default function ResourceCatalog({ resources, apiUrl, homeDir, registryError }: Props) {
  const [query, setQuery] = useState('');
  const [activeType, setActiveType] = useState<ResourceType>(resources[0]?.type ?? 'skills');
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all');
  const [installedFilter, setInstalledFilter] = useState<InstalledFilter>('all');
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortOption>('updated');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Record<string, Action>>({});
  const [harnesses, setHarnesses] = useState<Harness[]>(['claude-code']);
  const [plan, setPlan] = useState<ChangePlan | null>(null);
  const [planStatus, setPlanStatus] = useState('');
  const [planError, setPlanError] = useState(false);
  const [force, setForce] = useState(false);
  const [applied, setApplied] = useState(false);
  const [busy, setBusy] = useState(false);
  const requestId = useRef(0);
  const planTimer = useRef(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const activeTypeResources = resources.filter((resource) => resource.type === activeType);
  const filteredResources = activeTypeResources.filter((resource) => {
    const matchesQuery = [resourceId(resource), resource.description]
      .join(' ')
      .toLowerCase()
      .includes(query.trim().toLowerCase());
    const matchesReview = reviewFilter === 'all' || resource.reviewStatus === reviewFilter;
    const isInstalled = installedIds.has(resourceId(resource));
    const matchesInstalled = installedFilter === 'all'
      || (installedFilter === 'installed' ? isInstalled : !isInstalled);
    return matchesQuery && matchesReview && matchesInstalled;
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
  const hasFilters = query.trim().length > 0 || reviewFilter !== 'all' || installedFilter !== 'all' || sort !== 'updated';
  const activeTypeLabel = resourceTypeLabel(activeType);

  async function loadInstalled() {
    try {
      const result = await request<{ installations?: Installation[] }>(apiUrl, '/api/installed');
      setInstalledIds(new Set((result.installations ?? []).map((item) => item.resource)));
    } catch {
      setInstalledIds(new Set());
    }
  }

  useMountEffect(() => { void loadInstalled(); });

  function changeType(nextType: ResourceType) {
    setActiveType(nextType);
    setPage(1);
  }

  function clearFilters() {
    setQuery('');
    setReviewFilter('all');
    setInstalledFilter('all');
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
  ) {
    const nextResources = resources.filter((resource) => nextSelected[resourceId(resource)]);
    if (nextResources.length === 0) {
      setPlan(null);
      setPlanStatus('');
      return;
    }
    if (nextHarnesses.length === 0) {
      setPlan(null);
      setPlanStatus('');
      return;
    }

    const currentRequest = ++requestId.current;
    const operations = nextResources.map((resource) => ({
      resource: resourceId(resource),
      action: nextSelected[resourceId(resource)] ?? 'install',
      harnesses: nextHarnesses,
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
      setPlanStatus('');
    } catch (cause) {
      if (currentRequest === requestId.current) {
        setPlanError(true);
        setPlanStatus(errorMessage(cause, 'Could not generate the change plan.'));
      }
    }
  }

  function schedulePlan(nextSelected = selected, nextHarnesses = harnesses) {
    clearTimeout(planTimer.current);
    planTimer.current = window.setTimeout(() => void requestPlan(nextSelected, nextHarnesses), 200);
  }

  function selectResource(resource: ResourceSummary, checked: boolean) {
    const id = resourceId(resource);
    const nextSelected = checked
      ? { ...selected, [id]: installedIds.has(id) ? ('uninstall' as const) : ('install' as const) }
      : removeSelectedKey(selected, id);
    setSelected(nextSelected);
    schedulePlan(nextSelected);
  }

  function updateHarness(value: Harness, checked: boolean) {
    const nextHarnesses = checked
      ? [...harnesses, value]
      : harnesses.filter((harness) => harness !== value);
    setHarnesses(nextHarnesses);
    schedulePlan(selected, nextHarnesses);
  }

  function clearSelection() {
    clearTimeout(planTimer.current);
    setSelected({});
    setPlan(null);
    setPlanStatus('');
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
      void loadInstalled();
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
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_11rem_11rem_13rem] xl:items-end">
                    <label className="fieldset">
                      <span className="fieldset-legend">Search {activeTypeLabel.toLowerCase()}</span>
                      <input className="input w-full" type="search" placeholder="Name, owner, or description" value={query} onInput={(event) => { setQuery(event.currentTarget.value); setPage(1); }} />
                    </label>
                    <label className="fieldset">
                      <span className="fieldset-legend">Review status</span>
                      <select className="select w-full" value={reviewFilter} onChange={(event) => {
                        // SAFETY: The select options are exactly the ReviewFilter values.
                        setReviewFilter(event.currentTarget.value as ReviewFilter);
                        setPage(1);
                      }}>
                        <option value="all">All resources</option>
                        <option value="reviewed">Reviewed</option>
                        <option value="unreviewed">Unreviewed</option>
                      </select>
                    </label>
                    <label className="fieldset">
                      <span className="fieldset-legend">Installed</span>
                      <select className="select w-full" value={installedFilter} onChange={(event) => {
                        // SAFETY: The select options are exactly the InstalledFilter values.
                        setInstalledFilter(event.currentTarget.value as InstalledFilter);
                        setPage(1);
                      }}>
                        <option value="all">All</option>
                        <option value="installed">Installed</option>
                        <option value="not-installed">Not installed</option>
                      </select>
                    </label>
                    <label className="fieldset">
                      <span className="fieldset-legend">Sort by</span>
                      <select className="select w-full" value={sort} onChange={(event) => {
                        // SAFETY: The select options are exactly the SortOption values.
                        setSort(event.currentTarget.value as SortOption);
                        setPage(1);
                      }}>
                        <option value="updated">Recently updated</option>
                        <option value="name">Name A-Z</option>
                        <option value="version">Newest version</option>
                      </select>
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-base-300 pt-3">
                    <p className="text-xs text-base-content/60" aria-live="polite">
                      {sortedResources.length === 0 ? 'No resources found' : 'Showing ' + (pageStart + 1) + '-' + Math.min(pageStart + PAGE_SIZE, sortedResources.length) + ' of ' + sortedResources.length}
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
                        installed={installedIds.has(resourceId(resource))}
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
                        : 'Try a different search or filter.'}
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
        {selectedResources.length > 0 && (
          <div className="mb-5 flex items-center justify-between gap-3">
            <p className="text-sm text-base-content/60">Review the staged changes, then apply them.</p>
            <button className="btn btn-ghost btn-xs shrink-0" type="button" onClick={clearSelection}>Discard changes</button>
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

        {selectedResources.length === 0 ? (
          <div className="alert alert-info mt-5 items-start text-sm">
            <i className="ph ph-info text-lg" aria-hidden="true"></i>
            <span>Select resources from the catalog to stage changes here.</span>
          </div>
        ) : (
          plan && <PlanView plan={plan} showResource homeDir={homeDir} actions={selected} onRemove={(resource) => {
            const resourceSummary = resources.find((candidate) => resourceId(candidate) === resource);
            if (resourceSummary) selectResource(resourceSummary, false);
          }} force={force} onForce={setForce} status={planStatus} statusError={planError} busy={busy} onApply={() => void applyPlan()} />
        )}
      </DrawerShell>
    </>
  );
}
