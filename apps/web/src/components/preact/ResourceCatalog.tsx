import { useRef, useState } from 'preact/hooks';
import { resourceKey, type ResourceSummary, type ResourceType } from '@ai-directory/contracts';
import { useChangeDeck } from './ChangeDeckContext';
import { RESOURCE_TYPE_LABELS } from './lib';
import type { Action } from './types';

type Props = {
  resources: ResourceSummary[];
  registryError?: string | undefined;
};

type ReviewFilter = 'all' | 'reviewed' | 'unreviewed';
type InstalledFilter = 'all' | 'installed' | 'not-installed';
type SortOption = 'updated' | 'name' | 'version';

const PAGE_SIZE = 6;
// SAFETY: RESOURCE_TYPE_LABELS keys are exactly the ResourceType union.
const RESOURCE_TYPES = (Object.keys(RESOURCE_TYPE_LABELS) as ResourceType[]).map((value) => ({
  value,
  label: RESOURCE_TYPE_LABELS[value] + 's',
}));

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
  stagedAction,
  installed,
  presentLocally,
  onSelect,
}: {
  resource: ResourceSummary;
  stagedAction: Action | undefined;
  installed: boolean;
  presentLocally: boolean;
  onSelect: (checked: boolean) => void;
}) {
  const id = resourceKey(resource);
  const reviewed = resource.reviewStatus === 'reviewed';
  const isStaged = stagedAction !== undefined;
  const selectedClass = stagedAction === 'uninstall'
    ? 'border-error bg-error/5'
    : stagedAction === 'install'
      ? 'border-primary bg-primary/5'
      : '';

  const selectLabel = stagedAction === 'install' || !installed
    ? 'Select ' + id + ' to install'
    : 'Select ' + id + ' to uninstall';
  const ariaLabel = isStaged ? 'Unselect ' + id : selectLabel;

  return (
    <article
      className={'card card-border relative transition-colors hover:border-primary ' + (isStaged ? selectedClass : 'bg-base-100')}
      data-resource
      data-type={resource.type}
      data-resource-id={id}
      data-search={[id, resource.description].join(' ').toLowerCase()}
    >
      <button
        className="absolute inset-0 cursor-pointer appearance-none border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-primary"
        type="button"
        aria-label={ariaLabel}
        aria-pressed={isStaged}
        onClick={() => onSelect(!isStaged)}
      ></button>
      <div className="card-body pointer-events-none relative gap-4 p-5">
        <div>
          <div className="flex items-center justify-between gap-3">
            <h3 className="card-title min-w-0 flex-1 text-lg">
              <a className="pointer-events-auto block truncate link link-hover" href={detailPath(resource)}>{resource.name}</a>
            </h3>
            <span className="flex shrink-0 items-center gap-1">
              {stagedAction === 'install' && (
                <span className="badge badge-primary badge-sm gap-1">
                  <i className="ph ph-download-simple text-xs" aria-hidden="true"></i>
                  Install
                </span>
              )}
              {stagedAction === 'uninstall' && (
                <span className="badge badge-error badge-sm gap-1">
                  <i className="ph ph-trash text-xs" aria-hidden="true"></i>
                  Uninstall
                </span>
              )}
              {!isStaged && installed && (
                <span className="badge badge-success badge-sm gap-1">
                  <i className="ph ph-check text-xs" aria-hidden="true"></i>
                  Installed
                </span>
              )}
              {!isStaged && !installed && (
                <span className="badge badge-ghost badge-sm">Not installed</span>
              )}
              {!isStaged && presentLocally && !installed && (
                <span className="badge badge-soft badge-info badge-sm gap-1" title="A local resource with this name is already configured outside this registry">
                  <i className="ph ph-wrench text-xs" aria-hidden="true"></i>
                  Present locally
                </span>
              )}
              <span className={'badge badge-soft badge-sm ' + (reviewed ? 'badge-success' : 'badge-warning')}>
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

export default function ResourceCatalog({ resources, registryError }: Props) {
  const { installations, localResources, staged, stage, unstage } = useChangeDeck();
  const installedIds = new Set(installations.map((item) => item.resource));
  const locallyPresentKeys = new Set(
    localResources
      .filter((resource) => !resource.resource)
      .map((resource) => resource.type + '/' + resource.name),
  );
  const [query, setQuery] = useState('');
  const [activeType, setActiveType] = useState<ResourceType>(resources[0]?.type ?? 'skills');
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all');
  const [installedFilter, setInstalledFilter] = useState<InstalledFilter>('all');
  const [sort, setSort] = useState<SortOption>('updated');
  const [page, setPage] = useState(1);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const activeTypeResources = resources.filter((resource) => resource.type === activeType);
  const filteredResources = activeTypeResources.filter((resource) => {
    const matchesQuery = [resourceKey(resource), resource.description]
      .join(' ')
      .toLowerCase()
      .includes(query.trim().toLowerCase());
    const matchesReview = reviewFilter === 'all' || resource.reviewStatus === reviewFilter;
    const isInstalled = installedIds.has(resourceKey(resource));
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
  const hasFilters = query.trim().length > 0 || reviewFilter !== 'all' || installedFilter !== 'all' || sort !== 'updated';
  const activeTypeLabel = resourceTypeLabel(activeType);

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

  function selectResource(resource: ResourceSummary, checked: boolean) {
    const id = resourceKey(resource);
    if (checked) {
      stage({
        key: id,
        resource: id,
        type: resource.type,
        action: installedIds.has(id) ? 'uninstall' : 'install',
      });
    } else {
      unstage(id);
    }
  }

  return (
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
                      key={resourceKey(resource)}
                      resource={resource}
                      stagedAction={staged[resourceKey(resource)]?.action}
                      installed={installedIds.has(resourceKey(resource))}
                      presentLocally={locallyPresentKeys.has(resource.type + '/' + resource.name)}
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
  );
}
