import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { toast } from 'sonner';
import { ArrowUpRight } from '@phosphor-icons/react/dist/csr/ArrowUpRight';
import { Check } from '@phosphor-icons/react/dist/csr/Check';
import { Copy } from '@phosphor-icons/react/dist/csr/Copy';
import { FileText } from '@phosphor-icons/react/dist/csr/FileText';
import { MagnifyingGlass } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { Wrench } from '@phosphor-icons/react/dist/csr/Wrench';
import { resourceKey, type ResourceSummary } from '@ai-directory/contracts';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../../components/ui/accordion';
import { Badge } from '../../components/ui/badge';
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '../../components/ui/breadcrumb';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Checkbox } from '../../components/ui/checkbox';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../../components/ui/empty';
import { Field, FieldLabel } from '../../components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupInput } from '../../components/ui/input-group';
import { Label } from '../../components/ui/label';
import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from '../../components/ui/pagination';
import { RadioGroup, RadioGroupItem } from '../../components/ui/radio-group';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { api } from '../../lib/api';
import {
  detailPath,
  harnessOptions,
  RESOURCE_TYPE_LABELS,
  scopeOptions,
  type Action,
  type Harness,
  type InstallScope,
  type RegistryResponse,
  type ResourceType,
  type StagedItem,
} from '../../lib/types';
import { cn } from '../../lib/utils';
import { useDirectory } from './context';
import { ErrorMessage, LoadingCard } from './common';
import {
  installScope,
  PAGE_SIZE,
  RESOURCE_TYPES,
  resourceType,
  reviewFilter,
  installedFilter,
  sortOption,
  updatedLabel,
  type ReviewFilter,
  type InstalledFilter,
  type SortOption,
} from './model';

export function CatalogCard({
  resource,
  installed,
  presentLocally,
  stagedAction,
  onStage,
}: {
  resource: ResourceSummary;
  installed: boolean;
  presentLocally: boolean;
  stagedAction: Action | undefined;
  onStage: () => void;
}) {
  const id = resourceKey(resource);
  const reviewed = resource.reviewStatus === 'reviewed';

  return (
    <Card
      className={cn(
        'relative transition-colors hover:border-primary/50',
        stagedAction === 'install' && 'border-primary bg-primary/5',
        stagedAction === 'uninstall' && 'border-destructive bg-destructive/5',
      )}
    >
      <Button
        className="absolute inset-0 z-0 h-full w-full rounded-lg bg-transparent p-0 hover:bg-transparent hover:text-inherit"
        variant="ghost"
        type="button"
        aria-label={stagedAction ? `Unstage ${id}` : `Stage ${id} for ${installed ? 'uninstall' : 'install'}`}
        aria-pressed={stagedAction !== undefined}
        onClick={onStage}
      >
        <span className="sr-only">{stagedAction ? `Unstage ${id}` : `Stage ${id} for ${installed ? 'uninstall' : 'install'}`}</span>
      </Button>
      <CardContent className="pointer-events-none relative z-10 space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link className="pointer-events-auto block truncate text-lg font-semibold tracking-tight hover:text-primary" to={detailPath(resource)}>
              {resource.name}
            </Link>
            <p className="mt-1 text-xs text-muted-foreground">{resource.owner} · {id}</p>
          </div>
          <Badge variant={reviewed ? 'success' : 'warning'}>{reviewed ? 'Reviewed' : 'Unreviewed'}</Badge>
        </div>
        <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">{resource.description}</p>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground">
          <span>v{resource.latestVersion} · Updated {updatedLabel(resource.updatedAt)}</span>
          <div className="pointer-events-auto flex items-center gap-2">
            {installed && <Badge variant="success"><Check size={13} /> Installed</Badge>}
            {!installed && <Badge variant="muted">Not installed</Badge>}
            {presentLocally && !installed && <Badge variant="muted"><Wrench size={13} /> Local</Badge>}
            <Button variant={stagedAction ? 'secondary' : 'outline'} size="sm" onClick={onStage}>
              {stagedAction === 'install'
                ? 'Staged'
                : stagedAction === 'uninstall'
                  ? 'Unstage removal'
                  : installed
                    ? 'Stage removal'
                    : 'Stage install'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function CatalogPage() {
  const registry = useQuery<RegistryResponse>({ queryKey: ['registry'], queryFn: api.registry });
  const { installations, localResources, staged, harnesses, stage, unstage } = useDirectory();
  const resources = registry.data?.index?.resources.filter((resource) => resource.lifecycleStatus === 'active') ?? [];
  const installedIds = useMemo(() => new Set(installations.map((item) => item.resource)), [installations]);
  const localIds = useMemo(
    () => new Set(localResources.filter((item) => !item.resource).map((item) => `${item.type}/${item.name}`)),
    [localResources],
  );
  const [activeType, setActiveType] = useState<ResourceType>(() => resources[0]?.type ?? 'skills');
  const [query, setQuery] = useState('');
  const [review, setReview] = useState<ReviewFilter>('all');
  const [installed, setInstalled] = useState<InstalledFilter>('all');
  const [sort, setSort] = useState<SortOption>('updated');
  const [page, setPage] = useState(1);

  const typeResources = resources.filter((resource) => resource.type === activeType);
  const filtered = [...typeResources]
    .filter((resource) => {
      const matchesQuery = `${resourceKey(resource)} ${resource.description}`.toLowerCase().includes(query.trim().toLowerCase());
      const matchesReview = review === 'all' || resource.reviewStatus === review;
      const isInstalled = installedIds.has(resourceKey(resource));
      const matchesInstalled = installed === 'all' || (installed === 'installed' ? isInstalled : !isInstalled);
      return matchesQuery && matchesReview && matchesInstalled;
    })
    .sort((left, right) =>
      sort === 'name'
        ? left.name.localeCompare(right.name)
        : sort === 'version'
          ? right.latestVersion.localeCompare(left.latestVersion, undefined, { numeric: true })
          : right.updatedAt.localeCompare(left.updatedAt),
    );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function select(resource: ResourceSummary) {
    const id = resourceKey(resource);
    const stagedItem = staged[id];
    if (stagedItem) return unstage(id);
    stage({
      key: id,
      resource: id,
      type: resource.type,
      action: installedIds.has(id) ? 'uninstall' : 'install',
      harnesses: [...harnesses],
    });
  }

  function clearFilters() {
    setQuery('');
    setReview('all');
    setInstalled('all');
    setSort('updated');
    setPage(1);
  }

  function changeType(nextType: ResourceType) {
    setActiveType(nextType);
    setPage(1);
  }

  if (registry.isPending) return <div className="space-y-8"><PageIntro /><LoadingCard /></div>;
  if (registry.error) {
    return (
      <div className="space-y-8">
        <PageIntro />
        <ErrorMessage message={registry.error instanceof Error ? registry.error.message : 'Could not load the registry.'} />
      </div>
    );
  }

  const registryError = registry.data?.error;
  return (
    <div className="space-y-8">
      <PageIntro />
      {registryError && <ErrorMessage message={`${registryError} Run aid setup or pass --index <path>.`} />}
      {resources.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia><FileText size={20} /></EmptyMedia>
            <EmptyTitle>No active resources yet</EmptyTitle>
            <EmptyDescription>Publish the first resource, then refresh the registry.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <section aria-labelledby="catalog-title">
          <Tabs value={activeType} onValueChange={(value) => changeType(resourceType(value))}>
            <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-none border-b bg-transparent p-0" aria-label="Resource types">
              {RESOURCE_TYPES.map((option) => (
                <TabsTrigger
                  className="shrink-0 rounded-none border-b-2 border-transparent px-3 py-3 text-sm data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                  value={option.value}
                  key={option.value}
                >
                  {option.label}
                  <span className="text-xs text-muted-foreground">
                    ({resources.filter((resource) => resource.type === option.value).length})
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value={activeType} className="mt-5 rounded-xl border bg-card p-4">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_11rem_11rem_13rem]">
                <Field>
                  <FieldLabel htmlFor="resource-search">Search {RESOURCE_TYPE_LABELS[activeType].toLowerCase()}s</FieldLabel>
                  <InputGroup className="mt-2">
                    <InputGroupAddon><MagnifyingGlass /></InputGroupAddon>
                    <InputGroupInput
                      id="resource-search"
                      type="search"
                      placeholder="Name, owner, or description"
                      value={query}
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setPage(1);
                      }}
                    />
                  </InputGroup>
                </Field>
                <Field>
                  <FieldLabel htmlFor="resource-review">Review status</FieldLabel>
                  <Select value={review} onValueChange={(value) => { setReview(reviewFilter(value)); setPage(1); }}>
                    <SelectTrigger id="resource-review" className="mt-2"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="all">All resources</SelectItem><SelectItem value="reviewed">Reviewed</SelectItem><SelectItem value="unreviewed">Unreviewed</SelectItem></SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="resource-installed">Installed</FieldLabel>
                  <Select value={installed} onValueChange={(value) => { setInstalled(installedFilter(value)); setPage(1); }}>
                    <SelectTrigger id="resource-installed" className="mt-2"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="installed">Installed</SelectItem><SelectItem value="not-installed">Not installed</SelectItem></SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="resource-sort">Sort by</FieldLabel>
                  <Select value={sort} onValueChange={(value) => { setSort(sortOption(value)); setPage(1); }}>
                    <SelectTrigger id="resource-sort" className="mt-2"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="updated">Recently updated</SelectItem><SelectItem value="name">Name A-Z</SelectItem><SelectItem value="version">Newest version</SelectItem></SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="mt-4 flex items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground">
                <span>{filtered.length === 0 ? 'No resources found' : `Showing ${(currentPage - 1) * PAGE_SIZE + 1}-${Math.min(currentPage * PAGE_SIZE, filtered.length)} of ${filtered.length}`}</span>
                {(query || review !== 'all' || installed !== 'all' || sort !== 'updated') && <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>}
              </div>
            </TabsContent>
          </Tabs>
          {visible.length > 0 ? (
            <>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
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
                <Pagination className="mt-6 justify-between">
                  <PaginationContent className="w-full justify-between">
                    <PaginationItem><PaginationPrevious disabled={currentPage === 1} onClick={() => setPage(Math.max(1, currentPage - 1))} /></PaginationItem>
                    <PaginationItem><span className="self-center px-2 text-xs text-muted-foreground">Page {currentPage} of {pageCount}</span></PaginationItem>
                    <PaginationItem><PaginationNext disabled={currentPage === pageCount} onClick={() => setPage(Math.min(pageCount, currentPage + 1))} /></PaginationItem>
                  </PaginationContent>
                </Pagination>
              )}
            </>
          ) : (
            <Empty className="mt-5">
              <EmptyHeader>
                <EmptyMedia><MagnifyingGlass size={20} /></EmptyMedia>
                <EmptyTitle>{typeResources.length === 0 ? `No ${RESOURCE_TYPE_LABELS[activeType].toLowerCase()}s yet` : 'No matching resources'}</EmptyTitle>
                <EmptyDescription>{typeResources.length === 0 ? 'Publish a resource to add it to this registry.' : 'Try a different search or filter.'}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </section>
      )}
    </div>
  );
}

function PageIntro() {
  return (
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <h1 id="catalog-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">Find the right resource for the next task.</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">Browse reviewed skills, agents, rules, servers, and tools. Stage changes together and apply them when the plan looks right.</p>
      </div>
      <Badge variant="outline">Local registry</Badge>
    </div>
  );
}

export function ResourcePage() {
  const params = useParams({ from: '/resources/$owner/$type/$name' });
  const resourceQuery = useQuery({
    queryKey: ['resource', params.owner, params.type, params.name],
    queryFn: () => api.resource(params.owner, params.type, params.name),
  });
  const { staged, harnesses, stage, unstage } = useDirectory();
  const id = `${params.owner}/${params.type}/${params.name}`;
  const item = staged[id];
  const resource = resourceQuery.data?.resource;

  if (resourceQuery.isPending) return <LoadingCard />;
  if (resourceQuery.error || !resource) {
    return <ErrorMessage message={resourceQuery.error instanceof Error ? resourceQuery.error.message : 'Resource not found.'} />;
  }

  const version = resourceQuery.data.version;
  return (
    <div className="space-y-8">
      <div>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem><Link className="transition-colors hover:text-foreground" to="/">Catalog</Link></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>{resource.name}</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="mt-6 flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{RESOURCE_TYPE_LABELS[resource.type]}</Badge>
              <Badge variant={resource.reviewStatus === 'reviewed' ? 'success' : 'warning'}>{resource.reviewStatus === 'reviewed' ? 'Reviewed' : 'Unreviewed'}</Badge>
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">{resource.name}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{resource.owner} · v{resource.latestVersion} · Updated {updatedLabel(resource.updatedAt)}</p>
          </div>
          <Button variant={item ? 'secondary' : 'default'} onClick={() => item ? unstage(id) : stage({ key: id, resource: id, type: resource.type, action: 'install', harnesses: [...harnesses] })}>
            {item ? 'Staged in Changes' : 'Stage install'} <ArrowUpRight size={16} />
          </Button>
        </div>
        <p className="mt-6 max-w-3xl text-base leading-7 text-muted-foreground">{resource.description}</p>
      </div>
      {resourceQuery.data.error && <ErrorMessage message={resourceQuery.data.error} />}
      {version ? (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileText size={18} /> Source files</CardTitle></CardHeader>
          <CardContent>
            <Accordion type="multiple" defaultValue={version.files[0] ? [version.files[0].path] : []} className="space-y-2">
              {version.files.map((file) => (
                <AccordionItem className="overflow-hidden rounded-lg border" key={file.path} value={file.path}>
                  <AccordionTrigger className="px-3 py-2 hover:no-underline"><code className="font-mono text-xs">{file.path}</code></AccordionTrigger>
                  <AccordionContent className="border-t bg-muted/40 px-4 pb-4 pt-3"><ScrollArea className="h-80"><pre className="text-xs leading-5"><code>{file.content}</code></pre></ScrollArea></AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      ) : !resourceQuery.data.error ? (
        <Empty><EmptyHeader><EmptyMedia><FileText size={20} /></EmptyMedia><EmptyTitle>No files found</EmptyTitle><EmptyDescription>The registry index points to a package with no readable files.</EmptyDescription></EmptyHeader></Empty>
      ) : null}
      <InstallPanel resource={resource} staged={item} />
    </div>
  );
}

function InstallPanel({ resource, staged }: { resource: ResourceSummary; staged: StagedItem | undefined }) {
  const { harnesses, scope, setScope, stage, unstage } = useDirectory();
  const [selectedHarnesses, setSelectedHarnesses] = useState<Harness[]>(staged?.harnesses ?? harnesses);
  const [selectedScope, setSelectedScope] = useState<InstallScope>(staged?.scope ?? scope);
  const [copied, setCopied] = useState(false);
  const id = resourceKey(resource);
  const command = selectedHarnesses.length === 0 ? '' : `aid install ${id} ${selectedHarnesses.map((item) => `--harness ${item}`).join(' ')}${resource.type === 'mcp-servers' ? ` --scope ${selectedScope}` : ''}`;

  function toggleHarness(harness: Harness, checked: boolean) {
    setSelectedHarnesses((current) => checked ? [...current, harness].filter((item, index, list) => list.indexOf(item) === index) : current.filter((item) => item !== harness));
  }

  function save() {
    if (selectedHarnesses.length === 0) return;
    const item: StagedItem = { key: id, resource: id, type: resource.type, action: 'install', harnesses: selectedHarnesses };
    if (resource.type === 'mcp-servers') item.scope = selectedScope;
    stage(item);
  }

  async function copy() {
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      toast.success('Install command copied.');
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
      toast.error('Could not copy the install command.');
    }
  }

  return (
    <section aria-labelledby="install-title">
      <h2 id="install-title" className="text-xl font-semibold tracking-tight">Install this resource</h2>
      <p className="mt-2 text-sm text-muted-foreground">Choose the target harnesses, then review the change plan before applying it.</p>
      <Card className="mt-5">
        <CardContent className="space-y-6 p-5 sm:p-6">
          <Field>
            <FieldLabel>Install in</FieldLabel>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {harnessOptions.map((option) => (
                <Label className={cn('flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-3 text-sm transition-colors', selectedHarnesses.includes(option.value) ? 'border-primary/50 bg-primary/5' : 'border-border')} htmlFor={`install-harness-${option.value}`} key={option.value}>
                  <Checkbox id={`install-harness-${option.value}`} checked={selectedHarnesses.includes(option.value)} onCheckedChange={(checked) => toggleHarness(option.value, checked === true)} />
                  <span>{option.label}</span>
                </Label>
              ))}
            </div>
          </Field>
          {resource.type === 'mcp-servers' && (
            <Field className="border-t pt-5">
              <FieldLabel>Scope</FieldLabel>
              <RadioGroup className="mt-3 grid gap-2 sm:grid-cols-2" value={selectedScope} onValueChange={(value) => { const next = installScope(value); setSelectedScope(next); setScope(next); }}>
                {scopeOptions.map((option) => (
                  <Label className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 text-sm" htmlFor={`resource-scope-${option.value}`} key={option.value}>
                    <RadioGroupItem className="mt-0.5" id={`resource-scope-${option.value}`} value={option.value} />
                    <span><span className="block font-medium">{option.label}</span><span className="mt-1 block text-xs text-muted-foreground">{option.hint}</span></span>
                  </Label>
                ))}
              </RadioGroup>
            </Field>
          )}
          <div className="border-t pt-5">
            <InputGroup className="bg-muted">
              <InputGroupInput value={command || 'Select at least one harness.'} readOnly aria-label="Install command" />
              <InputGroupAddon align="inline-end">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="Copy install command" onClick={() => void copy()}>{copied ? <Check size={17} /> : <Copy size={17} />}</Button>
                  </TooltipTrigger>
                  <TooltipContent>{copied ? 'Copied' : 'Copy install command'}</TooltipContent>
                </Tooltip>
              </InputGroupAddon>
            </InputGroup>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">{selectedHarnesses.length === 0 ? 'Select at least one harness.' : staged ? 'Saved in Changes.' : `${selectedHarnesses.length} harness${selectedHarnesses.length === 1 ? '' : 'es'} selected.`}</span>
              <div className="flex gap-2">
                {staged && <Button variant="ghost" onClick={() => unstage(id)}>Remove</Button>}
                <Button onClick={save} disabled={selectedHarnesses.length === 0}>{staged ? 'Update Changes' : 'Add to Changes'} <ArrowUpRight size={16} /></Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
