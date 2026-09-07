import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Accordion } from '../../components/ui/accordion';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Field, FieldLabel } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '../../components/ui/input-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Skeleton } from '../../components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { cn } from '../../lib/utils';
import { api, type InstallRequest, type ResourceDirectoryInput } from '../../lib/api';
import { harnessLabel, harnessOptions, RESOURCE_TYPE_LABELS, shortenHomePath, type Harness, type InstallScope, type LocalResource } from '../../lib/types';
import { ErrorMessage, SheetFrame } from './common';
import { useDirectory } from './context';
import { installScope, parseHarnessFilter, parseInstalledGroup, parseSourceFilter, type HarnessFilter, type InstalledGroup, type InstalledTab, type SourceFilter } from './model';
import { LocalResourceRow } from './local-resource-row';
import { DirectoryEmpty } from './shared';
import { HugeiconsIcon } from '@hugeicons/react';
import { Folder01Icon, HardDriveIcon, InfoIcon, PlusSignIcon, RefreshIcon, Search01Icon } from '@hugeicons/core-free-icons';

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

const directoryTypeOptions = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'skills', label: 'Skills' },
  { value: 'agents', label: 'Agents' },
  { value: 'rules', label: 'Rules' },
  { value: 'plugins', label: 'Plugins' },
  { value: 'tools', label: 'Tools' },
] as const;

const directoryHarnessOptions = [
  { value: 'auto', label: 'All harnesses' },
  ...harnessOptions,
] as const;

const directoryScopeOptions = [
  { value: 'user', label: 'User' },
  { value: 'project', label: 'Project' },
] as const;

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
  const [directoryType, setDirectoryType] = useState<ResourceDirectoryInput['type']>('auto');
  const [directoryHarness, setDirectoryHarness] = useState<'auto' | Harness>('auto');
  const [directoryScope, setDirectoryScope] = useState<InstallScope>('user');

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

  const addDirectoryMutation = useMutation({
    mutationFn: () => {
      const body: ResourceDirectoryInput = { path: directoryPath.trim(), scope: directoryScope };
      if (directoryType && directoryType !== 'auto') body.type = directoryType;
      if (directoryHarness !== 'auto') body.harness = directoryHarness;
      return api.resourceDirectoryAdd(body);
    },
    onSuccess: () => {
      toast.success('Added the custom directory. Rescanning local resources.');
      setDirectoryPath('');
      refresh();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not add the directory.'),
  });

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
            Extra folders scanned alongside the harness defaults. Each folder keeps its own scope, harness, and type.
          </p>
          {resourceDirectoriesError && <ErrorMessage message={resourceDirectoriesError} />}
          {resourceDirectoriesLoading ? (
            <LoadingList rows={2} />
          ) : resourceDirectories.length > 0 ? (
            <Card className="gap-0 py-0">
              <ul className="divide-y px-4">
                {resourceDirectories.map((directory) => {
                  const count = localResources.filter((resource) => resource.sourcePath === directory.path).length;
                  return (
                    <li key={`${directory.scope}:${directory.path}`} className="flex items-start justify-between gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-xs font-medium" title={directory.path}>
                          {shortenHomePath(directory.path, homeDirectory)}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                          {directory.scope} · {directory.harness ?? 'all harnesses'} · {directory.type ?? 'auto'} · {count} {count === 1 ? 'resource' : 'resources'}
                        </p>
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
              description="Add the folder below. It appears here and its resources join the Resources tab."
            />
          )}
          <Card className="gap-3 p-4">
            <div>
              <p className="text-sm font-medium">Add a folder</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Use auto-detect unless the folder holds one type.</p>
            </div>
            <Field>
              <FieldLabel htmlFor="custom-directory-path">Folder path</FieldLabel>
              <Input
                id="custom-directory-path"
                placeholder="~/work/shared-skills"
                value={directoryPath}
                onChange={(event) => setDirectoryPath(event.target.value)}
              />
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field>
                <FieldLabel htmlFor="custom-directory-type">Type</FieldLabel>
                <Select value={directoryType ?? 'auto'} onValueChange={(value) => { if (value === 'auto' || value === 'skills' || value === 'agents' || value === 'rules' || value === 'plugins' || value === 'tools') setDirectoryType(value); }}>
                  <SelectTrigger id="custom-directory-type" className="w-full"><SelectValue>{selectedLabel(directoryTypeOptions, directoryType ?? 'auto')}</SelectValue></SelectTrigger>
                  <SelectContent>{directoryTypeOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="custom-directory-harness">Harness</FieldLabel>
                <Select value={directoryHarness} onValueChange={(value) => { if (value === 'auto' || value === 'claude-code' || value === 'opencode' || value === 'codex') setDirectoryHarness(value); }}>
                  <SelectTrigger id="custom-directory-harness" className="w-full"><SelectValue>{selectedLabel(directoryHarnessOptions, directoryHarness)}</SelectValue></SelectTrigger>
                  <SelectContent>{directoryHarnessOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="custom-directory-scope">Scope</FieldLabel>
                <Select value={directoryScope} onValueChange={(value) => { if (value !== null) setDirectoryScope(installScope(value)); }}>
                  <SelectTrigger id="custom-directory-scope" className="w-full"><SelectValue>{selectedLabel(directoryScopeOptions, directoryScope)}</SelectValue></SelectTrigger>
                  <SelectContent>{directoryScopeOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            </div>
            <div>
              <Button
                size="sm"
                onClick={() => void addDirectoryMutation.mutateAsync()}
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
