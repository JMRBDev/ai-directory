import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { resourceKey } from '@ai-directory/contracts';
import { Button } from '../../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { api } from '../../lib/api';
import { RESOURCE_TYPE_LABELS, type RegistryResponse, type ResourceType } from '../../lib/types';
import { ErrorMessage, LoadingCards } from './feedback';
import { CatalogCard } from './catalog-card';
import { CatalogFilters } from './catalog-filters';
import { useDirectory } from './context';
import { DirectoryEmpty, NoResourcesEmpty } from './shared';
import { activeResourceType, PAGE_SIZE, RESOURCE_TYPES, resourceType, type InstalledFilter, type ReviewFilter, type SortOption } from './model';
import { HugeiconsIcon } from '@hugeicons/react';
import { Search01Icon } from '@hugeicons/core-free-icons';

export function CatalogPage() {
  const registry = useQuery<RegistryResponse>({ queryKey: ['registry'], queryFn: api.registry });
  const { installations, localResources, staged, harnesses, stage, unstage } = useDirectory();
  const resources = useMemo(
    () => registry.data?.index?.resources.filter((resource) => resource.lifecycleStatus === 'active') ?? [],
    [registry.data],
  );
  const installedIds = useMemo(() => new Set(installations.map((item) => item.resource)), [installations]);
  const localIds = useMemo(() => new Set(localResources.filter((item) => !item.resource).map((item) => `${item.type}/${item.name}`)), [localResources]);
  const [selectedType, setSelectedType] = useState<ResourceType>();
  const [query, setQuery] = useState('');
  const [review, setReview] = useState<ReviewFilter>('all');
  const [installed, setInstalled] = useState<InstalledFilter>('all');
  const [sort, setSort] = useState<SortOption>('updated');
  const [page, setPage] = useState(1);
  const activeType = activeResourceType(resources, selectedType);

  const typeResources = useMemo(() => resources.filter((resource) => resource.type === activeType), [resources, activeType]);
  const filtered = useMemo(() => [...typeResources]
    .filter((resource) => {
      const matchesQuery = `${resourceKey(resource)} ${resource.description}`.toLowerCase().includes(query.trim().toLowerCase());
      const matchesReview = review === 'all' || resource.reviewStatus === review;
      const isInstalled = installedIds.has(resourceKey(resource));
      const matchesInstalled = installed === 'all' || (installed === 'installed' ? isInstalled : !isInstalled);
      return matchesQuery && matchesReview && matchesInstalled;
    })
    .sort((left, right) => sort === 'name' ? left.name.localeCompare(right.name) : sort === 'version' ? right.latestVersion.localeCompare(left.latestVersion, undefined, { numeric: true }) : right.updatedAt.localeCompare(left.updatedAt)), [typeResources, query, review, installed, sort, installedIds]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function select(resource: (typeof resources)[number]) {
    const id = resourceKey(resource);
    if (staged[id]) return unstage(id);
    stage({ key: id, resource: id, type: resource.type, action: installedIds.has(id) ? 'uninstall' : 'install', harnesses: [...harnesses] });
  }

  function clearFilters() {
    setQuery('');
    setReview('all');
    setInstalled('all');
    setSort('updated');
    setPage(1);
  }

  if (registry.isPending) return <div className="flex flex-col gap-6"><PageIntro /><LoadingCards /></div>;
  if (registry.error) return <div className="flex flex-col gap-6"><PageIntro /><ErrorMessage message={registry.error instanceof Error ? registry.error.message : 'Could not load the registry.'} /></div>;

  const registryError = registry.data?.error;
  return (
    <div className="flex flex-col gap-6">
      <PageIntro />
      {registryError && <ErrorMessage message={`${registryError} Run aid setup or pass --index <path>.`} />}
      {resources.length === 0 ? (
        <NoResourcesEmpty />
      ) : (
        <section aria-labelledby="catalog-title">          <Tabs value={activeType} onValueChange={(value) => { setSelectedType(resourceType(value)); setPage(1); }}>
            <TabsList className="max-w-full justify-start overflow-x-auto" aria-label="Resource types">
              {RESOURCE_TYPES.map((option) => (
                <TabsTrigger className="shrink-0" value={option.value} key={option.value}>
                  {option.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value={activeType} className="mt-4">
              <CatalogFilters
                activeType={activeType}
                query={query}
                review={review}
                installed={installed}
                sort={sort}
                filteredCount={filtered.length}
                currentPage={currentPage}
                pageSize={PAGE_SIZE}
                onQueryChange={(value) => { setQuery(value); setPage(1); }}
                onReviewChange={(value) => { setReview(value); setPage(1); }}
                onInstalledChange={(value) => { setInstalled(value); setPage(1); }}
                onSortChange={(value) => { setSort(value); setPage(1); }}
                onClear={clearFilters}
              />
            </TabsContent>
          </Tabs>
          {visible.length > 0 ? (
            <>
              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {visible.map((resource) => {
                  const id = resourceKey(resource);
                  return (
                    <CatalogCard
                      key={id}
                      resource={resource}
                      stagedAction={staged[id]?.action}
                      installed={installedIds.has(id)}
                      presentLocally={localIds.has(`${resource.type}/${resource.name}`)}
                      onStage={() => select(resource)}
                    />
                  );
                })}
              </div>
              {pageCount > 1 && (
                <div className="mt-6 flex items-center justify-between">
                  <p className="text-xs text-muted-foreground tabular-nums">Page {currentPage} of {pageCount}</p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setPage(Math.max(1, currentPage - 1))}>Previous</Button>
                    <Button variant="outline" size="sm" disabled={currentPage === pageCount} onClick={() => setPage(Math.min(pageCount, currentPage + 1))}>Next</Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <DirectoryEmpty
              icon={<HugeiconsIcon icon={Search01Icon} />}
              title={typeResources.length === 0 ? `No ${RESOURCE_TYPE_LABELS[activeType].toLowerCase()}s yet` : 'No matching resources'}
              description={typeResources.length === 0 ? 'Publish a resource to add it to this registry.' : 'Try a different search or filter.'}
            />
          )}
        </section>
      )}
    </div>
  );
}

function PageIntro() {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 id="catalog-title" className="font-heading text-2xl">Catalog</h1>
        <p className="mt-1 text-sm text-muted-foreground">Browse the registry, then apply staged changes together from Changes.</p>
      </div>
    </div>
  );
}
