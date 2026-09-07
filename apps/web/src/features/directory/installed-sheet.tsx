import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Autocomplete } from '@base-ui/react/autocomplete';
import { Accordion } from '../../components/ui/accordion';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Field, FieldLabel } from '../../components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '../../components/ui/input-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Skeleton } from '../../components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { cn } from '../../lib/utils';
import { api, type BrowseDirectoriesResponse, type InstallRequest, type ResourceDirectoryInput } from '../../lib/api';
import { harnessLabel, harnessOptions, RESOURCE_TYPE_LABELS, shortenHomePath, type Harness, type InstallScope, type LocalResource } from '../../lib/types';
import { ErrorMessage, SheetFrame } from './common';
import { useDirectory } from './context';
import { installScope, parseHarnessFilter, parseInstalledGroup, parseSourceFilter, type HarnessFilter, type InstalledGroup, type InstalledTab, type SourceFilter } from './model';
import { LocalResourceRow } from './local-resource-row';
import { DirectoryEmpty } from './shared';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowUp01Icon, Folder01Icon, HardDriveIcon, Home01Icon, InfoIcon, PlusSignIcon, RefreshIcon, Search01Icon } from '@hugeicons/core-free-icons';

const harnessFilterOptions = [
  { value: 'all', label: 'All harnesses' },
  ...harnessOptions,
] as const;

const sourceOptions = [
  { value: 'all', label: 'All sources' },
  { value: 'registry', label: 'From this registry' },
  { value: 'local', label: 'Not from this registry' },
  { value: 'custom', label: 'Custom directories' },
] as const;

const groupOptions: Array<{ value: InstalledGroup; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'attention', label: 'Needs attention' },
  { value: 'managed', label: 'Managed' },
  { value: 'unmanaged', label: 'Unmanaged' },
];

const directoryScopeOptions = [
  { value: 'user', label: 'User' },
  { value: 'project', label: 'Project' },
] as const;

type BrowseItem = { path: string; displayPath: string; name: string; resourceCount: number };

// Home-relative paths render with the immutable ~/ addon, so the input
// holds just the part after home. Absolute paths outside home are kept
// as typed. joinHomePath rejoins the relative form for submit.
function joinHomePath(relativePath: string): string {
  const trimmed = relativePath.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith('~')) return trimmed;
  if (trimmed.startsWith('/')) return trimmed;
  return `~/${trimmed.replace(/^\/+/, '')}`;
}

function selectedLabel<T extends string>(options: ReadonlyArray<{ value: T; label: string }>, value: T): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

function needsAttention(resource: LocalResource): boolean {
  return resource.state === 'missing'
    || resource.state === 'modified'
    || resource.registryState === 'outdated';
}

function attentionRank(resource: LocalResource): number {
  if (resource.state === 'missing') return 0;
  if (resource.state === 'modified') return 1;
  if (resource.registryState === 'outdated') return 2;
  if (resource.state === 'managed') return 3;
  return 4;
}

function resourceKeyOf(resource: LocalResource): string {
  return `${resource.harness}-${resource.path}`;
}

export function InstalledSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const {
    localResources,
    localError,
    localLoading,
    localRegistryError,
    resourceDirectories,
    resourceDirectoriesError,
    resourceDirectoriesLoading,
    homeDirectory,
  } = useDirectory();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<InstalledTab>('resources');
  const [query, setQuery] = useState('');
  const [harnessFilter, setHarnessFilter] = useState<HarnessFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [group, setGroup] = useState<InstalledGroup>('all');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [busyGroup, setBusyGroup] = useState<Harness | null>(null);
  const [removingPath, setRemovingPath] = useState<string | null>(null);
  const [directoryPath, setDirectoryPath] = useState('');
  const [directoryScope, setDirectoryScope] = useState<InstallScope>('user');
  const [browseBase, setBrowseBase] = useState<string | undefined>(undefined);
  const [browseSearch, setBrowseSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  // Debounce the recursive search so every keystroke does not fan out a
  // filesystem walk. 250ms feels instant but collapses fast typing.
  useEffect(() => {
    if (browseSearch.trim().length < 2) {
      setDebouncedSearch('');
      return;
    }
    const timer = window.setTimeout(() => setDebouncedSearch(browseSearch.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [browseSearch]);
  const browse = useQuery<BrowseDirectoriesResponse>({
    queryKey: ['browse-directories', browseBase ?? 'home', tab, debouncedSearch],
    queryFn: () => api.browseDirectories(browseBase, debouncedSearch || undefined),
    enabled: open && tab === 'folders',
    staleTime: 0,
    gcTime: 0,
  });
  const browseInputRef = useRef<HTMLInputElement | null>(null);

  const stats = useMemo(() => ({
    total: localResources.length,
    attention: localResources.filter(needsAttention).length,
    managed: localResources.filter((resource) => resource.state === 'managed').length,
    custom: localResources.filter((resource) => resource.source === 'custom').length,
  }), [localResources]);

  const visibleResources = useMemo(() => localResources
    .filter((resource) => {
      const text = `${resource.name} ${resource.resource ?? ''} ${resource.path}`.toLowerCase();
      const matchesQuery = !query.trim() || text.includes(query.trim().toLowerCase());
      const matchesHarness = harnessFilter === 'all' || resource.harness === harnessFilter;
      const matchesSource = sourceFilter === 'all'
        || (sourceFilter === 'registry' ? resource.resource !== undefined : sourceFilter === 'local' ? resource.resource === undefined : resource.source === 'custom');
      const matchesGroup = group === 'all'
        || (group === 'attention' ? needsAttention(resource) : resource.state === group);
      return matchesQuery && matchesHarness && matchesSource && matchesGroup;
    })
    .sort((left, right) => attentionRank(left) - attentionRank(right) || left.name.localeCompare(right.name)),
  [localResources, query, harnessFilter, sourceFilter, group]);

  const harnessGroups = useMemo(() => {
    const ordered = harnessFilter === 'all' ? harnessOptions.map((option) => option.value) : [harnessFilter];
    return ordered
      .map((harness) => ({
        harness,
        resources: visibleResources.filter((resource) => resource.harness === harness),
      }))
      .filter((entry) => entry.resources.length > 0);
  }, [visibleResources, harnessFilter]);

  const groupActionable = useMemo(() => {
    const result = new Map<Harness, LocalResource[]>();
    for (const entry of harnessGroups) {
      const actionable = entry.resources.filter((resource) =>
        resource.resource && (resource.state === 'missing' || resource.state === 'modified' || resource.registryState === 'outdated'),
      );
      if (actionable.length > 0) result.set(entry.harness, actionable);
    }
    return result;
  }, [harnessGroups]);

  const hasFilters = Boolean(query.trim() || harnessFilter !== 'all' || sourceFilter !== 'all' || group !== 'all');

  function clearFilters() {
    setQuery('');
    setHarnessFilter('all');
    setSourceFilter('all');
    setGroup('all');
  }

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['installed'] });
    void queryClient.invalidateQueries({ queryKey: ['local-resources'] });
    void queryClient.invalidateQueries({ queryKey: ['resource-directories'] });
  }

  // The breadcrumb bar is the source of truth for where we browse and
  // never follows the staged input. A house rule applies: the list always
  // shows the base folder and the input always shows the staged path, even
  // when they differ (for example a leaf staged from home).
  const browseHome = browse.data?.home;
  useEffect(() => {
    if (tab === 'folders' && browseHome && browseBase === undefined) {
      setBrowseBase(browseHome);
    }
  }, [tab, browseHome, browseBase]);
  const browseBaseLabel = browse.data?.displayBase ?? (browseBase ? shortenHomePath(browseBase, homeDirectory) : '…');

  const browseItems: BrowseItem[] = useMemo(
    () => (browse.data?.entries ?? []).map((entry) => ({
      path: entry.path,
      displayPath: entry.displayPath,
      name: entry.name,
      resourceCount: entry.resourceCount,
    })),
    [browse.data],
  );

  // Picking a row stages the path in the input and clears the search so
  // the list returns to the browsed level. Home paths stage relative
  // (the ~/ addon renders the prefix); anything outside home (for example
  // /tmp) stages absolute so it is never mangled. Drill-in via double click.
  const relativeToHome = useMemo(() => {
    const home = browse.data?.home ?? homeDirectory;
    return (path: string) => {
      if (home && (path === home || path.startsWith(`${home}/`))) {
        return path.slice(home.length).replace(/^\/+/, '');
      }
      return path;
    };
  }, [browse.data?.home, homeDirectory]);
  const isAbsoluteStaged = directoryPath.trim().startsWith('/');

  function pickBrowseItem(item: BrowseItem) {
    setDirectoryPath(relativeToHome(item.path));
    setBrowseSearch('');
    setDebouncedSearch('');
    browseInputRef.current?.focus();
  }

  function drillBrowseItem(item: BrowseItem) {
    setDirectoryPath(relativeToHome(item.path));
    setBrowseSearch('');
    setDebouncedSearch('');
    setBrowseBase(item.path);
    browseInputRef.current?.focus();
  }

  const addDirectoryMutation = useMutation({
    mutationFn: (path: string) => {
      const body: ResourceDirectoryInput = { path: path.trim(), scope: directoryScope };
      return api.resourceDirectoryAdd(body);
    },
    onSuccess: () => {
      toast.success('Added the custom directory. Rescanning local resources.');
      setDirectoryPath('');
      refresh();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not add the directory.'),
  });

  function submitDirectoryPath(path: string) {
    const trimmed = path.trim();
    if (!trimmed || addDirectoryMutation.isPending) return;
    setBrowseSearch('');
    setDebouncedSearch('');
    void addDirectoryMutation.mutateAsync(trimmed);
  }

  async function removeDirectory(path: string) {
    if (removingPath) return;
    setRemovingPath(path);
    try {
      await api.resourceDirectoryRemove(path);
      toast.success('Removed the custom directory.');
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not remove the directory.');
    } finally {
      setRemovingPath(null);
    }
  }

  async function act(key: string, resource: LocalResource, action: 'install' | 'uninstall') {
    if (!resource.resource || busyKey || busyGroup) return;
    setBusyKey(key);
    try {
      if (action === 'install') {
        const body: InstallRequest = resource.type === 'mcp-servers'
          ? { resource: resource.resource, harnesses: [resource.harness], scope: resource.scope ?? 'user' }
          : { resource: resource.resource, harnesses: [resource.harness] };
        await api.install(body);
        toast.success(`Updated ${resource.resource}.`);
      } else {
        await api.uninstall(resource.resource, [resource.harness], resource.type === 'mcp-servers' ? (resource.scope ?? 'user') : undefined);
        toast.success(`Uninstalled ${resource.resource}.`);
      }
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The action failed.');
    } finally {
      setBusyKey(null);
    }
  }

  async function updateGroup(harness: Harness, resources: LocalResource[]) {
    if (busyKey || busyGroup) return;
    setBusyGroup(harness);
    try {
      let updated = 0;
      for (const resource of resources) {
        if (!resource.resource) continue;
        const body: InstallRequest = resource.type === 'mcp-servers'
          ? { resource: resource.resource, harnesses: [resource.harness], scope: resource.scope ?? 'user' }
          : { resource: resource.resource, harnesses: [resource.harness] };
        await api.install(body);
        updated += 1;
      }
      toast.success(updated === 1 ? `Updated 1 resource for ${harnessLabel(harness)}.` : `Updated ${updated} resources for ${harnessLabel(harness)}.`);
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The group update failed.');
    } finally {
      setBusyGroup(null);
    }
  }

  return (
    <SheetFrame
      open={open}
      onOpenChange={onOpenChange}
      title="Installed resources"
      description="Everything this machine picked up from harness folders and custom directories."
    >
      <Tabs value={tab} onValueChange={(value) => { if (value === 'resources' || value === 'folders') setTab(value); }}>
        <TabsList aria-label="Installed views" className="w-full">
          <TabsTrigger value="resources" className="flex-1">
            <HugeiconsIcon icon={HardDriveIcon} data-icon="inline-start" />
            Resources
            <span className="tabular-nums text-muted-foreground">{stats.total}</span>
          </TabsTrigger>
          <TabsTrigger value="folders" className="flex-1">
            <HugeiconsIcon icon={Folder01Icon} data-icon="inline-start" />
            Folders
            <span className="tabular-nums text-muted-foreground">{resourceDirectories.length}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="resources" className="mt-4 flex flex-col gap-4">
          <section aria-label="Local inventory" className="grid grid-cols-3 gap-2">
            <StatCard label="Found locally" value={stats.total} loading={localLoading} />
            <StatCard label="Needs attention" value={stats.attention} loading={localLoading} tone={stats.attention > 0 ? 'warning' : 'default'} />
            <StatCard label="From custom folders" value={stats.custom} loading={localLoading} />
          </section>
          <InputGroup>
            <InputGroupAddon><HugeiconsIcon icon={Search01Icon} /></InputGroupAddon>
            <InputGroupInput
              id="installed-search"
              type="search"
              placeholder="Search name, id, or path"
              aria-label="Search installed resources"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </InputGroup>
          <div className="grid grid-cols-2 gap-2">
            <Field>
              <FieldLabel htmlFor="installed-harness">Harness</FieldLabel>
              <Select value={harnessFilter} onValueChange={(value) => { if (value !== null) setHarnessFilter(parseHarnessFilter(value)); }}>
                <SelectTrigger id="installed-harness" className="w-full"><SelectValue>{selectedLabel(harnessFilterOptions, harnessFilter)}</SelectValue></SelectTrigger>
                <SelectContent>{harnessFilterOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="installed-source">Source</FieldLabel>
              <Select value={sourceFilter} onValueChange={(value) => { if (value !== null) setSourceFilter(parseSourceFilter(value)); }}>
                <SelectTrigger id="installed-source" className="w-full"><SelectValue>{selectedLabel(sourceOptions, sourceFilter)}</SelectValue></SelectTrigger>
                <SelectContent>{sourceOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Status filter">
              {groupOptions.map((option) => (
                <Button
                  key={option.value}
                  size="xs"
                  variant={group === option.value ? 'secondary' : 'ghost'}
                  onClick={() => setGroup(parseInstalledGroup(option.value))}
                  aria-pressed={group === option.value}
                >
                  {option.label}
                </Button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Refresh local scan"
              onClick={() => refresh()}
              disabled={localLoading}
            >
              <HugeiconsIcon icon={RefreshIcon} className={cn(localLoading && 'animate-spin')} />
            </Button>
          </div>
          {localError && <ErrorMessage message={localError} />}
          {localRegistryError && <ErrorMessage message={localRegistryError} />}
          {localLoading ? (
            <LoadingList />
          ) : !localError && harnessGroups.length > 0 ? (
            <>
              <p className="text-xs text-muted-foreground tabular-nums" role="status" aria-live="polite">
                {visibleResources.length} of {localResources.length} resource{localResources.length === 1 ? '' : 's'}
              </p>
              <div className="flex flex-col gap-3">
                {harnessGroups.map((entry) => {
                  const actionable = groupActionable.get(entry.harness) ?? [];
                  const attentionCount = entry.resources.filter(needsAttention).length;
                  return (
                    <section key={entry.harness} aria-label={`${harnessLabel(entry.harness)} resources`}>
                      <div className="flex items-center justify-between gap-2 px-1 pb-1.5">
                        <p className="text-xs font-medium tabular-nums">
                          {harnessLabel(entry.harness)}
                          <span className="font-normal text-muted-foreground">
                            {' · '}{entry.resources.length}{attentionCount > 0 ? ` · ${attentionCount} need attention` : ''}
                          </span>
                        </p>
                        {actionable.length > 0 && (
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={busyGroup === entry.harness || busyKey !== null}
                            onClick={() => void updateGroup(entry.harness, actionable)}
                          >
                            {busyGroup === entry.harness ? 'Updating…' : `Update ${actionable.length}`}
                          </Button>
                        )}
                      </div>
                      <Card className="gap-0 py-0">
                        <Accordion multiple>
                          {entry.resources.map((resource) => {
                            const key = resourceKeyOf(resource);
                            return (
                              <LocalResourceRow
                                key={key}
                                itemKey={key}
                                resource={resource}
                                busy={busyKey === key || busyGroup === entry.harness}
                                onInstall={() => void act(key, resource, 'install')}
                                onUninstall={() => void act(key, resource, 'uninstall')}
                              />
                            );
                          })}
                        </Accordion>
                      </Card>
                    </section>
                  );
                })}
              </div>
            </>
          ) : (
            <DirectoryEmpty
              icon={<HugeiconsIcon icon={InfoIcon} />}
              title={localResources.length === 0 ? 'No local resources found' : 'No matching resources'}
              description={localResources.length === 0
                ? 'Install from the catalog, or add a custom folder that holds skills, agents, rules, plugins, or tools.'
                : 'Try a different search or filter.'}
            />
          )}
          {hasFilters && visibleResources.length === 0 && localResources.length > 0 && !localLoading && (
            <Button variant="ghost" size="sm" className="self-center" onClick={clearFilters}>Clear filters</Button>
          )}
        </TabsContent>
        <TabsContent value="folders" className="mt-4 flex flex-col gap-4">
          <p className="text-xs text-muted-foreground">
            Extra folders scanned alongside the harness defaults. Just a path. Type and harness are detected from the
            files inside, and every harness can use what it understands.
          </p>
          {resourceDirectoriesError && <ErrorMessage message={resourceDirectoriesError} />}
          {resourceDirectoriesLoading ? (
            <LoadingList rows={2} />
          ) : resourceDirectories.length > 0 ? (
            <Card className="gap-0 py-0">
              <ul className="divide-y px-4">
                {resourceDirectories.map((directory) => {
                  const matches = localResources.filter((resource) => resource.sourcePath === directory.path);
                  const count = new Map(matches.map((resource) => [resource.path, true])).size;
                  const kinds = [...new Set(matches.map((resource) => RESOURCE_TYPE_LABELS[resource.type]))];
                  const harnesses = [...new Set(matches.map((resource) => resource.harness))];
                  return (
                    <li key={`${directory.scope}:${directory.path}`} className="flex items-start justify-between gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-xs font-medium" title={directory.path}>
                          {shortenHomePath(directory.path, homeDirectory)}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                          {directory.scope} · {count} {count === 1 ? 'resource' : 'resources'}
                          {kinds.length > 0 ? ` · ${kinds.join(', ')}` : ''}
                        </p>
                        {harnesses.length > 0 && (
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            Readable by {harnesses.map(harnessLabel).join(', ')}
                          </p>
                        )}
                        <FolderPreview path={directory.path} resources={localResources} />
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void removeDirectory(directory.path)}
                        disabled={removingPath === directory.path}
                        aria-label={`Remove ${directory.path}`}
                      >
                        {removingPath === directory.path ? 'Removing…' : 'Remove'}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : (
            <DirectoryEmpty
              icon={<HugeiconsIcon icon={Folder01Icon} />}
              title="No custom folders yet"
              description="Pick a folder below. It appears here and its resources join the Resources tab."
            />
          )}
          <Card className="gap-3 p-4">
            <div>
              <p className="text-sm font-medium">Add a folder</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                We scan it and its subfolders and figure out skills, agents, rules, plugins, and tools ourselves.
              </p>
            </div>
            <Field>
              <FieldLabel htmlFor="custom-directory-path">Folder path</FieldLabel>
              <Autocomplete.Root
                items={browseItems}
                value={directoryPath}
                onValueChange={(value, details) => {
                  // Home paths stage relative (the ~/ addon renders the
                  // prefix). Anything outside home stages absolute as typed.
                  // Item values are absolute, so relativize only under home.
                  const home = browse.data?.home ?? homeDirectory;
                  const relative = home && (value === home || value.startsWith(`${home}/`))
                    ? value.slice(home.length).replace(/^\/+/, '')
                    : value;
                  setDirectoryPath(relative);
                  // The same keystrokes drive the recursive server search.
                  // Typing never moves the browse base, so the one-level
                  // list stays put when there is no search yet.
                  setBrowseSearch(relative);
                  // A row click commits the item value into the input first;
                  // stage it and keep the list where it is.
                  if (details.reason === 'item-press') {
                    const match = browseItems.find((item) => item.path === value);
                    if (match) pickBrowseItem(match);
                  }
                }}
                autoHighlight={false}
                openOnInputClick
                mode="list"
                itemToStringValue={(item: BrowseItem) => relativeToHome(item.path)}
              >
                <InputGroup>
                  <Autocomplete.Input
                    id="custom-directory-path"
                    ref={browseInputRef}
                    data-slot="input-group-control"
                    placeholder="work/shared-skills"
                    aria-describedby="custom-directory-path-hint"
                    className="flex-1 rounded-none border-0 bg-transparent font-mono shadow-none ring-0 focus-visible:ring-0 aria-invalid:ring-0 dark:bg-transparent"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        submitDirectoryPath(isAbsoluteStaged ? directoryPath : joinHomePath(directoryPath));
                      }
                    }}
                  />
                  <InputGroupAddon>
                    <InputGroupText className="font-mono">{isAbsoluteStaged ? '¦' : '~/'}</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
                <p id="custom-directory-path-hint" className="text-[11px] text-muted-foreground">
                  {isAbsoluteStaged
                    ? 'Absolute path. It will be added exactly as shown.'
                    : 'Relative to your home folder. We expand it to the full path when you add it.'}
                </p>
                <Autocomplete.Portal>
                  <Autocomplete.Positioner sideOffset={4} className="z-50 outline-none">
                    <Autocomplete.Popup className="max-h-64 w-(--anchor-width) overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
                      <div className="flex items-center gap-1 border-b border-border px-1.5 pb-1 text-[11px] text-muted-foreground">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label="Go to home folder"
                          onClick={() => {
                            if (browse.data?.home) {
                              setBrowseBase(browse.data.home);
                              browseInputRef.current?.focus();
                            }
                          }}
                        >
                          <HugeiconsIcon icon={Home01Icon} />
                        </Button>
                        <span className="min-w-0 flex-1 truncate font-mono" title={browse.data?.base ?? browseBase}>
                          {browseBaseLabel}
                        </span>
                        {browse.data?.parent && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label="Go up one folder"
                            onClick={() => {
                              setBrowseBase(browse.data?.parent);
                              browseInputRef.current?.focus();
                            }}
                          >
                            <HugeiconsIcon icon={ArrowUp01Icon} />
                          </Button>
                        )}
                        {browse.isFetching && <span>Loading…</span>}
                      </div>
                      <Autocomplete.Empty className="px-2 py-3 text-xs text-muted-foreground">
                        {browse.isPending || browse.isFetching
                          ? 'Searching folders…'
                          : browse.error
                            ? 'Could not list folders.'
                            : debouncedSearch
                              ? `No folders matching “${debouncedSearch}” under ${browseBaseLabel}. Press Enter to add this path.`
                              : 'No subfolders here. Press Enter to add this path.'}
                      </Autocomplete.Empty>
                      <Autocomplete.List className="outline-none">
                        {(item: BrowseItem) => (
                          <Autocomplete.Item
                            key={item.path}
                            value={item}
                            className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                            onClick={() => pickBrowseItem(item)}
                            onDoubleClick={() => drillBrowseItem(item)}
                          >
                            <HugeiconsIcon icon={Folder01Icon} className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">{item.name}</span>
                              <span className="block truncate font-mono text-[11px] text-muted-foreground tabular-nums">
                                {item.displayPath}
                              </span>
                            </span>
                          </Autocomplete.Item>
                        )}
                      </Autocomplete.List>
                    </Autocomplete.Popup>
                  </Autocomplete.Positioner>
                </Autocomplete.Portal>
              </Autocomplete.Root>
            </Field>
            <Field>
              <FieldLabel htmlFor="custom-directory-scope">Save scope</FieldLabel>
              <Select value={directoryScope} onValueChange={(value) => { if (value !== null) setDirectoryScope(installScope(value)); }}>
                <SelectTrigger id="custom-directory-scope" className="w-full max-w-44"><SelectValue>{selectedLabel(directoryScopeOptions, directoryScope)}</SelectValue></SelectTrigger>
                <SelectContent>{directoryScopeOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <div>
              <Button
                size="sm"
                onClick={() => submitDirectoryPath(isAbsoluteStaged ? directoryPath : joinHomePath(directoryPath))}
                disabled={!directoryPath.trim() || addDirectoryMutation.isPending}
              >
                <HugeiconsIcon icon={PlusSignIcon} data-icon="inline-start" />
                {addDirectoryMutation.isPending ? 'Adding…' : 'Add folder'}
              </Button>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </SheetFrame>
  );
}

function StatCard({ label, value, loading, tone = 'default' }: {
  label: string;
  value: number;
  loading: boolean;
  tone?: 'default' | 'warning';
}) {
  return (
    <Card size="sm" className={cn('gap-1 p-3', tone === 'warning' && value > 0 && 'border-amber-500/40')}>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      {loading ? (
        <Skeleton className="h-6 w-10" />
      ) : (
        <p className={cn('text-xl font-semibold tracking-tight tabular-nums', tone === 'warning' && value > 0 && 'text-amber-700 dark:text-amber-300')}>
          {value}
        </p>
      )}
    </Card>
  );
}

function LoadingList({ rows = 4 }: { rows?: number }) {
  return (
    <Card className="gap-0 py-0" aria-label="Loading installed resources">
      <ul className="divide-y px-4">
        {Array.from({ length: rows }, (_, index) => (
          <li key={index} className="flex items-start justify-between gap-3 py-3.5">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-6 w-16 shrink-0" />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function FolderPreview({ path, resources }: { path: string; resources: LocalResource[] }) {
  const matches = resources.filter((resource) => resource.sourcePath === path);
  const entries = matches.slice(0, 3);
  if (entries.length === 0) return null;
  return (
    <p className="mt-1 truncate text-[11px] text-muted-foreground" title={entries.map((entry) => entry.name).join(', ')}>
      {entries.map((entry) => `${RESOURCE_TYPE_LABELS[entry.type]} ${entry.name}`).join(' · ')}
      {matches.length > entries.length && ' · …'}
    </p>
  );
}
