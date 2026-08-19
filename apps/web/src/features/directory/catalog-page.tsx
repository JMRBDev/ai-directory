import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText } from '@phosphor-icons/react/dist/csr/FileText';
import { MagnifyingGlass } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { resourceKey } from '@ai-directory/contracts';
import { Badge } from '../../components/ui/badge';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../../components/ui/empty';
import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from '../../components/ui/pagination';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { api } from '../../lib/api';
import { RESOURCE_TYPE_LABELS, type RegistryResponse, type ResourceType } from '../../lib/types';
import { ErrorMessage, LoadingCard } from './common';
import { CatalogCard } from './catalog-card';
import { CatalogFilters } from './catalog-filters';
import { useDirectory } from './context';
import { activeResourceType, PAGE_SIZE, RESOURCE_TYPES, resourceType, type InstalledFilter, type ReviewFilter, type SortOption } from './model';

export function CatalogPage() {
  const registry = useQuery<RegistryResponse>({ queryKey: ['registry'], queryFn: api.registry });
  const { installations, localResources, staged, harnesses, stage, unstage } = useDirectory();
  const resources = registry.data?.index?.resources.filter((resource) => resource.lifecycleStatus === 'active') ?? [];
  const installedIds = useMemo(() => new Set(installations.map((item) => item.resource)), [installations]);
  const localIds = useMemo(() => new Set(localResources.filter((item) => !item.resource).map((item) => `${item.type}/${item.name}`)), [localResources]);
  const [selectedType, setSelectedType] = useState<ResourceType>();
  const [query, setQuery] = useState('');
  const [review, setReview] = useState<ReviewFilter>('all');
  const [installed, setInstalled] = useState<InstalledFilter>('all');
  const [sort, setSort] = useState<SortOption>('updated');
  const [page, setPage] = useState(1);
  const activeType = activeResourceType(resources, selectedType);

  const typeResources = resources.filter((resource) => resource.type === activeType);
  const filtered = [...typeResources]
    .filter((resource) => {
      const matchesQuery = `${resourceKey(resource)} ${resource.description}`.toLowerCase().includes(query.trim().toLowerCase());
      const matchesReview = review === 'all' || resource.reviewStatus === review;
      const isInstalled = installedIds.has(resourceKey(resource));
      const matchesInstalled = installed === 'all' || (installed === 'installed' ? isInstalled : !isInstalled);
      return matchesQuery && matchesReview && matchesInstalled;
    })
    .sort((left, right) => sort === 'name' ? left.name.localeCompare(right.name) : sort === 'version' ? right.latestVersion.localeCompare(left.latestVersion, undefined, { numeric: true }) : right.updatedAt.localeCompare(left.updatedAt));
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

  if (registry.isPending) return <div className="space-y-8"><PageIntro /><LoadingCard /></div>;
  if (registry.error) return <div className="space-y-8"><PageIntro /><ErrorMessage message={registry.error instanceof Error ? registry.error.message : 'Could not load the registry.'} /></div>;

  const registryError = registry.data?.error;
  return (
    <div className="space-y-8">
      <PageIntro />
      {registryError && <ErrorMessage message={`${registryError} Run aid setup or pass --index <path>.`} />}
      {resources.length === 0 ? (
        <Empty><EmptyHeader><EmptyMedia><FileText size={20} /></EmptyMedia><EmptyTitle>No active resources yet</EmptyTitle><EmptyDescription>Publish the first resource, then refresh the registry.</EmptyDescription></EmptyHeader></Empty>
      ) : (
        <section aria-labelledby="catalog-title">
            <Tabs value={activeType} onValueChange={(value) => { setSelectedType(resourceType(value)); setPage(1); }}>
            <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-none border-b bg-transparent p-0" aria-label="Resource types">
              {RESOURCE_TYPES.map((option) => <TabsTrigger className="shrink-0 rounded-none border-b-2 border-transparent px-3 py-3 text-sm data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none" value={option.value} key={option.value}>{option.label} <span className="text-xs text-muted-foreground">({resources.filter((resource) => resource.type === option.value).length})</span></TabsTrigger>)}
            </TabsList>
            <TabsContent value={activeType} className="mt-5 rounded-xl border bg-card p-4">
              <CatalogFilters activeType={activeType} query={query} review={review} installed={installed} sort={sort} filteredCount={filtered.length} currentPage={currentPage} pageSize={PAGE_SIZE} onQueryChange={(value) => { setQuery(value); setPage(1); }} onReviewChange={(value) => { setReview(value); setPage(1); }} onInstalledChange={(value) => { setInstalled(value); setPage(1); }} onSortChange={(value) => { setSort(value); setPage(1); }} onClear={clearFilters} />
            </TabsContent>
          </Tabs>
          {visible.length > 0 ? <>
            <div className="mt-4 grid gap-4 md:grid-cols-2">{visible.map((resource) => { const id = resourceKey(resource); return <CatalogCard key={id} resource={resource} stagedAction={staged[id]?.action} installed={installedIds.has(id)} presentLocally={localIds.has(`${resource.type}/${resource.name}`)} onStage={() => select(resource)} />; })}</div>
            {pageCount > 1 && <Pagination className="mt-6 justify-between"><PaginationContent className="w-full justify-between"><PaginationItem><PaginationPrevious disabled={currentPage === 1} onClick={() => setPage(Math.max(1, currentPage - 1))} /></PaginationItem><PaginationItem><span className="self-center px-2 text-xs text-muted-foreground">Page {currentPage} of {pageCount}</span></PaginationItem><PaginationItem><PaginationNext disabled={currentPage === pageCount} onClick={() => setPage(Math.min(pageCount, currentPage + 1))} /></PaginationItem></PaginationContent></Pagination>}
          </> : <Empty className="mt-5"><EmptyHeader><EmptyMedia><MagnifyingGlass size={20} /></EmptyMedia><EmptyTitle>{typeResources.length === 0 ? `No ${RESOURCE_TYPE_LABELS[activeType].toLowerCase()}s yet` : 'No matching resources'}</EmptyTitle><EmptyDescription>{typeResources.length === 0 ? 'Publish a resource to add it to this registry.' : 'Try a different search or filter.'}</EmptyDescription></EmptyHeader></Empty>}
        </section>
      )}
    </div>
  );
}

function PageIntro() {
  return <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h1 id="catalog-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">Find the right resource for the next task.</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">Browse reviewed skills, agents, rules, servers, and tools. Stage changes together and apply them when the plan looks right.</p></div><Badge variant="outline">Local registry</Badge></div>;
}
