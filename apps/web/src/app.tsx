import { createContext, useContext, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate, useParams } from '@tanstack/react-router';
import { ArrowUpRight } from '@phosphor-icons/react/dist/csr/ArrowUpRight';
import { ArrowsClockwise } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { Check } from '@phosphor-icons/react/dist/csr/Check';
import { Copy } from '@phosphor-icons/react/dist/csr/Copy';
import { FileText } from '@phosphor-icons/react/dist/csr/FileText';
import { Gear } from '@phosphor-icons/react/dist/csr/Gear';
import { Info } from '@phosphor-icons/react/dist/csr/Info';
import { ListDashes } from '@phosphor-icons/react/dist/csr/ListDashes';
import { MagnifyingGlass } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { Package } from '@phosphor-icons/react/dist/csr/Package';
import { Trash } from '@phosphor-icons/react/dist/csr/Trash';
import { UploadSimple } from '@phosphor-icons/react/dist/csr/UploadSimple';
import { WarningCircle } from '@phosphor-icons/react/dist/csr/WarningCircle';
import { Wrench } from '@phosphor-icons/react/dist/csr/Wrench';
import { resourceKey, type ResourceSummary } from '@ai-directory/contracts';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Separator } from './components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './components/ui/sheet';
import { api } from './lib/api';
import {
  detailPath,
  harnessLabel,
  harnessOptions,
  RESOURCE_TYPE_LABELS,
  resourceLabel,
  shortenHomePath,
  scopeOptions,
  type Action,
  type ApplyResponse,
  type ChangePlan,
  type Harness,
  type InstallScope,
  type LocalResource,
  type RegistryResponse,
  type ResourceType,
  type StagedItem,
  type StagedMap,
} from './lib/types';
import { cn } from './lib/utils';

type SheetName = 'changes' | 'installed' | 'settings' | 'publish' | null;
type ReviewFilter = 'all' | 'reviewed' | 'unreviewed';
type InstalledFilter = 'all' | 'installed' | 'not-installed';
type SortOption = 'updated' | 'name' | 'version';
type HarnessFilter = 'all' | Harness;
type SourceFilter = 'all' | 'registry' | 'local';

type DirectoryFile = File & { webkitRelativePath?: string };
type PublishReview = {
  resource: string;
  version: string;
  description: string;
  entryFile: string;
  files: string[];
};

const LOCAL_STATE_LABELS = {
  managed: 'Managed',
  modified: 'Modified',
  missing: 'Missing',
  unmanaged: 'Unmanaged',
} satisfies Record<LocalResource['state'], string>;

const REGISTRY_STATE_LABELS = {
  current: 'Current',
  outdated: 'Outdated',
  unknown: 'Unknown source',
} satisfies Record<LocalResource['registryState'], string>;

const RESOURCE_TYPES = [
  { value: 'skills', label: RESOURCE_TYPE_LABELS.skills + 's' },
  { value: 'agents', label: RESOURCE_TYPE_LABELS.agents + 's' },
  { value: 'rules', label: RESOURCE_TYPE_LABELS.rules + 's' },
  { value: 'mcp-servers', label: RESOURCE_TYPE_LABELS['mcp-servers'] + 's' },
  { value: 'templates', label: RESOURCE_TYPE_LABELS.templates + 's' },
  { value: 'plugins', label: RESOURCE_TYPE_LABELS.plugins + 's' },
  { value: 'tools', label: RESOURCE_TYPE_LABELS.tools + 's' },
] satisfies Array<{ value: ResourceType; label: string }>;
const PAGE_SIZE = 6;

function readStorage<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    // SAFETY: The browser stores JSON written by writeStorage under this application-owned key.
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage<T>(key: string, value: T) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A private browsing session can reject localStorage. The UI still works for this session.
  }
}

function subscribeSystemTheme(onChange: () => void) {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const handleChange = () => {
    if (document.documentElement.dataset.themePreference === 'system') {
      document.documentElement.classList.toggle('dark', media.matches);
    }
    onChange();
  };
  media.addEventListener('change', handleChange);
  return () => media.removeEventListener('change', handleChange);
}

function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function getServerSystemTheme() {
  return false;
}

function updatedLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function mergePlans(plans: ChangePlan[]): ChangePlan {
  return {
    operations: plans.flatMap((plan) => plan.operations ?? []),
    changes: plans.flatMap((plan) => plan.changes),
    conflicts: [...new Set(plans.flatMap((plan) => plan.conflicts))],
    warnings: [...new Set(plans.flatMap((plan) => plan.warnings))],
    projectionNotes: [...new Set(plans.flatMap((plan) => plan.projectionNotes))],
    dependencyRemovals: plans.flatMap((plan) => plan.dependencyRemovals ?? []),
    fingerprint: '',
  };
}

function hasApplyableOperation(plan: ChangePlan) {
  return plan.changes.length > 0 || plan.operations.some((operation) => operation.action === 'uninstall');
}

function operationsFor(items: StagedItem[], fallbackHarnesses: Harness[], fallbackScope: InstallScope) {
  return items.map((item) => {
    const operation = {
    resource: item.resource,
    action: item.action,
    harnesses: item.harnesses.length > 0 ? item.harnesses : fallbackHarnesses,
    };
    if (item.type === 'mcp-servers') return { ...operation, scope: item.scope ?? fallbackScope };
    return operation;
  });
}

function reviewFilter(value: string): ReviewFilter {
  return value === 'reviewed' || value === 'unreviewed' ? value : 'all';
}

function installedFilter(value: string): InstalledFilter {
  return value === 'installed' || value === 'not-installed' ? value : 'all';
}

function sortOption(value: string): SortOption {
  return value === 'name' || value === 'version' ? value : 'updated';
}

function installScope(value: string): InstallScope {
  return value === 'project' ? 'project' : 'user';
}

function resourceType(value: string): ResourceType {
  return RESOURCE_TYPES.find((option) => option.value === value)?.value ?? 'skills';
}

function parseHarnessFilter(value: string): HarnessFilter {
  if (value === 'all') return value;
  return harnessOptions.find((option) => option.value === value)?.value ?? 'all';
}

function parseSourceFilter(value: string): SourceFilter {
  return value === 'registry' || value === 'local' ? value : 'all';
}

function groupStaged(items: StagedItem[]) {
  return [
    { name: 'mcp', items: items.filter((item) => item.type === 'mcp-servers') },
    { name: 'files', items: items.filter((item) => item.type !== 'mcp-servers') },
  ].filter((group) => group.items.length > 0);
}

type GroupPlan = { name: string; items: StagedItem[]; plan: ChangePlan };
type PlanData = { plan: ChangePlan; groups: GroupPlan[] };

type DirectoryContextValue = {
  installations: NonNullable<Awaited<ReturnType<typeof api.installed>>['installations']>;
  localResources: LocalResource[];
  localRegistryError: string | undefined;
  homeDirectory: string | undefined;
  localLoading: boolean;
  staged: StagedMap;
  harnesses: Harness[];
  scope: InstallScope;
  sheet: SheetName;
  plan: PlanData | undefined;
  planLoading: boolean;
  planError: string | undefined;
  applyStatus: string | undefined;
  applyError: string | undefined;
  force: boolean;
  removeDependencies: boolean;
  busy: boolean;
  setSheet: (sheet: SheetName) => void;
  setHarnesses: (harnesses: Harness[]) => void;
  setScope: (scope: InstallScope) => void;
  setForce: (force: boolean) => void;
  setRemoveDependencies: (remove: boolean) => void;
  stage: (item: StagedItem) => void;
  updateStage: (item: StagedItem) => void;
  unstage: (key: string) => void;
  clear: () => void;
  applyChanges: () => void;
  refreshRegistry: () => void;
};

const DirectoryContext = createContext<DirectoryContextValue | null>(null);

function useDirectory() {
  const value = useContext(DirectoryContext);
  if (!value) throw new Error('useDirectory must be used inside DirectoryProvider.');
  return value;
}

export function DirectoryProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [sheet, setSheet] = useState<SheetName>(null);
  const [staged, setStaged] = useState<StagedMap>(() => readStorage('ai-directory-staged', {}));
  const [harnesses, setHarnessesState] = useState<Harness[]>(() => {
    const stored = readStorage<Harness[]>('ai-directory-harnesses', ['claude-code']);
    return stored.length > 0 ? stored : ['claude-code'];
  });
  const [scope, setScope] = useState<InstallScope>('user');
  const [force, setForce] = useState(false);
  const [removeDependencies, setRemoveDependencies] = useState(false);
  const [applyStatus, setApplyStatus] = useState<string | undefined>(undefined);
  const [applyError, setApplyError] = useState<string | undefined>(undefined);

  const installationsQuery = useQuery({ queryKey: ['installed'], queryFn: api.installed });
  const localResourcesQuery = useQuery({ queryKey: ['local-resources'], queryFn: api.localResources });
  const stagedItems = Object.values(staged);
  const groups = groupStaged(stagedItems);
  const planQuery = useQuery<PlanData>({
    queryKey: ['plan', stagedItems, harnesses, scope],
    enabled: stagedItems.length > 0 && harnesses.length > 0,
    queryFn: async () => {
      const groupPlans = await Promise.all(groups.map(async (group) => ({
        ...group,
        plan: await api.plan(operationsFor(group.items, harnesses, scope)),
      })));
      return { groups: groupPlans, plan: mergePlans(groupPlans.map((group) => group.plan)) };
    },
  });
  const applyMutation = useMutation({
    mutationFn: async ({ data, applyForce, removeDeps }: { data: PlanData; applyForce: boolean; removeDeps: boolean }) => {
      const results: ApplyResponse[] = [];
      for (const group of data.groups) {
        results.push(await api.apply({
          operations: operationsFor(group.items, harnesses, scope),
          force: applyForce,
          installDependencies: true,
          removeDependencies: removeDeps,
          planFingerprint: group.plan.fingerprint,
        }));
      }
      return results;
    },
    onMutate: () => {
      setApplyStatus(undefined);
      setApplyError(undefined);
    },
    onSuccess: (results) => {
      const changes = results.reduce((total, result) => total + result.plan.changes.length, 0);
      const warnings = results.flatMap((result) => result.warnings ?? []);
      setApplyStatus(warnings.length > 0 ? `Applied ${changes} file changes with warnings: ${warnings.join(' ')}` : `Applied ${changes} file changes.`);
      setStaged({});
      writeStorage('ai-directory-staged', {});
      setForce(false);
      setRemoveDependencies(false);
      void queryClient.invalidateQueries({ queryKey: ['installed'] });
      void queryClient.invalidateQueries({ queryKey: ['local-resources'] });
    },
    onError: (error) => {
      setApplyError(error instanceof Error ? error.message : 'Could not apply the change plan.');
    },
  });

  function setHarnesses(next: Harness[]) {
    const normalized = harnessOptions.map((option) => option.value).filter((item) => next.includes(item));
    if (normalized.length === 0) return;
    setHarnessesState(normalized);
    writeStorage('ai-directory-harnesses', normalized);
  }

  function saveStaged(next: StagedMap) {
    setStaged(next);
    writeStorage('ai-directory-staged', next);
  }

  function stage(item: StagedItem) {
    if (item.harnesses.length === 0) return;
    const normalized: StagedItem = { ...item, harnesses: [...new Set(item.harnesses)] };
    if (normalized.type === 'mcp-servers' && !normalized.scope) normalized.scope = scope;
    saveStaged({ ...staged, [normalized.key]: normalized });
    setSheet('changes');
  }

  function updateStage(item: StagedItem) {
    if (item.harnesses.length === 0) return;
    saveStaged({ ...staged, [item.key]: { ...item, harnesses: [...new Set(item.harnesses)] } });
  }

  function unstage(key: string) {
    const next = { ...staged };
    delete next[key];
    saveStaged(next);
  }

  function clear() {
    saveStaged({});
    setForce(false);
    setRemoveDependencies(false);
    setApplyStatus(undefined);
    setApplyError(undefined);
  }

  function applyChanges() {
    if (!planQuery.data || !hasApplyableOperation(planQuery.data.plan) || applyMutation.isPending) return;
    void applyMutation.mutateAsync({ data: planQuery.data, applyForce: force, removeDeps: removeDependencies });
  }

  function refreshRegistry() {
    void api.refresh().then(() => queryClient.invalidateQueries({ queryKey: ['registry'] }));
  }

  const value: DirectoryContextValue = {
    installations: installationsQuery.data?.installations ?? [],
    localResources: localResourcesQuery.data?.resources ?? [],
    localRegistryError: localResourcesQuery.data?.registryError,
    homeDirectory: localResourcesQuery.data?.homeDirectory,
    localLoading: localResourcesQuery.isFetching,
    staged,
    harnesses,
    scope,
    sheet,
    plan: planQuery.data,
    planLoading: planQuery.isPending && stagedItems.length > 0,
    planError: planQuery.error instanceof Error ? planQuery.error.message : undefined,
    applyStatus,
    applyError,
    force,
    removeDependencies,
    busy: applyMutation.isPending,
    setSheet,
    setHarnesses,
    setScope,
    setForce,
    setRemoveDependencies,
    stage,
    updateStage,
    unstage,
    clear,
    applyChanges,
    refreshRegistry,
  };

  return <DirectoryContext.Provider value={value}>{children}</DirectoryContext.Provider>;
}

function IconButton({ label, children, onClick }: { label: string; children: ReactNode; onClick: () => void }) {
  return <Button variant="ghost" size="icon" aria-label={label} title={label} onClick={onClick}>{children}</Button>;
}

function SiteHeader() {
  const { setSheet, staged } = useDirectory();
  const navigate = useNavigate();
  const [refreshing, setRefreshing] = useState(false);
  const { refreshRegistry } = useDirectory();

  function refresh() {
    setRefreshing(true);
    refreshRegistry();
    window.setTimeout(() => setRefreshing(false), 500);
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border/80 bg-background/90 backdrop-blur">
      <div className="mx-auto flex min-h-16 w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <button className="flex items-center gap-3 text-left" type="button" onClick={() => void navigate({ to: '/' })}>
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Package size={20} weight="bold" /></span>
          <span><span className="block font-semibold tracking-tight">AI Directory</span><span className="hidden text-xs text-muted-foreground sm:block">Reusable development resources</span></span>
        </button>
        <nav className="flex items-center gap-1" aria-label="Workspace actions">
          <IconButton label="Refresh registry" onClick={refresh}><ArrowsClockwise className={cn(refreshing && 'animate-spin')} size={18} /></IconButton>
          <IconButton label="Installed resources" onClick={() => setSheet('installed')}><ListDashes size={18} /></IconButton>
          <Button className="hidden sm:inline-flex" variant="outline" size="sm" onClick={() => setSheet('publish')}><UploadSimple size={16} /> Publish</Button>
          <span className="sm:hidden"><IconButton label="Publish resource" onClick={() => setSheet('publish')}><UploadSimple size={18} /></IconButton></span>
          <Button variant={Object.keys(staged).length > 0 ? 'default' : 'outline'} size="sm" onClick={() => setSheet('changes')}><ListDashes size={16} /> Changes{Object.keys(staged).length > 0 ? ` (${Object.keys(staged).length})` : ''}</Button>
          <IconButton label="Settings" onClick={() => setSheet('settings')}><Gear size={18} /></IconButton>
        </nav>
      </div>
    </header>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" role="alert"><WarningCircle className="mt-0.5 shrink-0" size={19} /><span>{message}</span></div>;
}

function LoadingCard() {
  return <Card><CardContent className="space-y-3 p-6"><div className="h-4 w-2/5 animate-pulse rounded bg-muted" /><div className="h-10 w-full animate-pulse rounded bg-muted" /><div className="h-4 w-3/5 animate-pulse rounded bg-muted" /></CardContent></Card>;
}

export function RootLayout() {
  return (
    <DirectoryProvider>
      <div className="flex min-h-screen flex-col bg-background text-foreground">
        <SiteHeader />
        <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:px-8 sm:py-10"><Outlet /></main>
        <footer className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 border-t px-5 py-6 text-xs text-muted-foreground sm:px-8"><span>Backed by the production resource registry.</span><span>Local-first workspace</span></footer>
        <WorkspaceSheets />
      </div>
    </DirectoryProvider>
  );
}

function WorkspaceSheets() {
  const { sheet, setSheet } = useDirectory();
  return <><ChangesSheet open={sheet === 'changes'} onOpenChange={(open) => setSheet(open ? 'changes' : null)} /><InstalledSheet open={sheet === 'installed'} onOpenChange={(open) => setSheet(open ? 'installed' : null)} /><SettingsSheet open={sheet === 'settings'} onOpenChange={(open) => setSheet(open ? 'settings' : null)} /><PublishSheet open={sheet === 'publish'} onOpenChange={(open) => setSheet(open ? 'publish' : null)} /></>;
}

function SheetFrame({ open, onOpenChange, title, description, children, className }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; children: ReactNode; className?: string }) {
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className={cn('w-full overflow-y-auto sm:max-w-2xl', className)}><SheetHeader><SheetTitle>{title}</SheetTitle><SheetDescription>{description}</SheetDescription></SheetHeader>{children}</SheetContent></Sheet>;
}

function CatalogCard({ resource, installed, presentLocally, stagedAction, onStage }: { resource: ResourceSummary; installed: boolean; presentLocally: boolean; stagedAction: Action | undefined; onStage: () => void }) {
  const id = resourceKey(resource);
  const reviewed = resource.reviewStatus === 'reviewed';
  return <Card className={cn('relative transition-colors hover:border-primary/50', stagedAction === 'install' && 'border-primary bg-primary/5', stagedAction === 'uninstall' && 'border-destructive bg-destructive/5')}>
    <button className="absolute inset-0 z-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" type="button" aria-label={stagedAction ? `Unstage ${id}` : `Stage ${id} for ${installed ? 'uninstall' : 'install'}`} aria-pressed={stagedAction !== undefined} onClick={onStage} />
    <CardContent className="pointer-events-none relative z-10 space-y-4 p-5">
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><Link className="block truncate text-lg font-semibold tracking-tight hover:text-primary" to={detailPath(resource)}>{resource.name}</Link><p className="mt-1 text-xs text-muted-foreground">{resource.owner} · {id}</p></div><Badge variant={reviewed ? 'success' : 'warning'}>{reviewed ? 'Reviewed' : 'Unreviewed'}</Badge></div>
      <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">{resource.description}</p>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground"><span>v{resource.latestVersion} · Updated {updatedLabel(resource.updatedAt)}</span><div className="pointer-events-auto flex items-center gap-2">{installed && <Badge variant="success"><Check size={13} /> Installed</Badge>}{!installed && <Badge variant="muted">Not installed</Badge>}{presentLocally && !installed && <Badge variant="muted"><Wrench size={13} /> Local</Badge>}<Button variant={stagedAction ? 'secondary' : 'outline'} size="sm" onClick={onStage}>{stagedAction === 'install' ? 'Staged' : stagedAction === 'uninstall' ? 'Unstage removal' : installed ? 'Stage removal' : 'Stage install'}</Button></div></div>
    </CardContent>
  </Card>;
}

export function CatalogPage() {
  const registry = useQuery<RegistryResponse>({ queryKey: ['registry'], queryFn: api.registry });
  const { installations, localResources, staged, harnesses, stage, unstage } = useDirectory();
  const resources = registry.data?.index?.resources.filter((resource) => resource.lifecycleStatus === 'active') ?? [];
  const installedIds = useMemo(() => new Set(installations.map((item) => item.resource)), [installations]);
  const localIds = useMemo(() => new Set(localResources.filter((item) => !item.resource).map((item) => `${item.type}/${item.name}`)), [localResources]);
  const [activeType, setActiveType] = useState<ResourceType>(() => resources[0]?.type ?? 'skills');
  const [query, setQuery] = useState('');
  const [review, setReview] = useState<ReviewFilter>('all');
  const [installed, setInstalled] = useState<InstalledFilter>('all');
  const [sort, setSort] = useState<SortOption>('updated');
  const [page, setPage] = useState(1);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const typeResources = resources.filter((resource) => resource.type === activeType);
  const filtered = [...typeResources].filter((resource) => {
    const matchesQuery = `${resourceKey(resource)} ${resource.description}`.toLowerCase().includes(query.trim().toLowerCase());
    const matchesReview = review === 'all' || resource.reviewStatus === review;
    const isInstalled = installedIds.has(resourceKey(resource));
    const matchesInstalled = installed === 'all' || (installed === 'installed' ? isInstalled : !isInstalled);
    return matchesQuery && matchesReview && matchesInstalled;
  }).sort((left, right) => sort === 'name' ? left.name.localeCompare(right.name) : sort === 'version' ? right.latestVersion.localeCompare(left.latestVersion, undefined, { numeric: true }) : right.updatedAt.localeCompare(left.updatedAt));
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function select(resource: ResourceSummary) {
    const id = resourceKey(resource);
    const stagedItem = staged[id];
    if (stagedItem) return unstage(id);
    stage({ key: id, resource: id, type: resource.type, action: installedIds.has(id) ? 'uninstall' : 'install', harnesses: [...harnesses] });
  }

  function clearFilters() {
    setQuery(''); setReview('all'); setInstalled('all'); setSort('updated'); setPage(1);
  }

  function changeType(nextType: ResourceType) {
    setActiveType(nextType);
    setPage(1);
  }

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    const nextIndex = (index + direction + RESOURCE_TYPES.length) % RESOURCE_TYPES.length;
    const nextOption = RESOURCE_TYPES[nextIndex];
    if (!nextOption) return;
    changeType(nextOption.value);
    tabRefs.current[nextIndex]?.focus();
  }

  if (registry.isPending) return <div className="space-y-8"><PageIntro /><LoadingCard /></div>;
  if (registry.error) return <div className="space-y-8"><PageIntro /><ErrorMessage message={registry.error instanceof Error ? registry.error.message : 'Could not load the registry.'} /></div>;

  const registryError = registry.data?.error;
  return <div className="space-y-8"><PageIntro />
    {registryError && <ErrorMessage message={`${registryError} Run aid setup or pass --index <path>.`} />}
    {resources.length === 0 ? <Card><CardContent className="p-6"><p className="font-medium">No active resources yet.</p><p className="mt-2 text-sm text-muted-foreground">Publish the first resource, then refresh the registry.</p></CardContent></Card> : <section aria-labelledby="catalog-title"><div className="flex gap-1 overflow-x-auto border-b" role="tablist" aria-label="Resource types">{RESOURCE_TYPES.map((option, index) => { const count = resources.filter((resource) => resource.type === option.value).length; const active = activeType === option.value; return <button className={cn('shrink-0 border-b-2 px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground', active ? 'border-primary text-foreground' : 'border-transparent')} id={`resource-tab-${option.value}`} key={option.value} type="button" role="tab" aria-selected={active} aria-controls="resource-tabpanel" tabIndex={active ? 0 : -1} ref={(element) => { tabRefs.current[index] = element; }} onClick={() => changeType(option.value)} onKeyDown={(event) => moveTab(event, index)}>{option.label} <span className="text-xs text-muted-foreground">({count})</span></button>; })}</div>
      <div id="resource-tabpanel" className="mt-5 rounded-xl border bg-card p-4" role="tabpanel" aria-labelledby={`resource-tab-${activeType}`} tabIndex={0}><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_11rem_11rem_13rem]"><div><Label htmlFor="resource-search">Search {RESOURCE_TYPE_LABELS[activeType].toLowerCase()}s</Label><div className="relative mt-2"><MagnifyingGlass className="pointer-events-none absolute left-3 top-2.5 text-muted-foreground" size={17} /><Input id="resource-search" className="pl-9" type="search" placeholder="Name, owner, or description" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /></div></div><SelectField label="Review status" value={review} onChange={(value) => { setReview(reviewFilter(value)); setPage(1); }} options={[['all', 'All resources'], ['reviewed', 'Reviewed'], ['unreviewed', 'Unreviewed']]} /><SelectField label="Installed" value={installed} onChange={(value) => { setInstalled(installedFilter(value)); setPage(1); }} options={[['all', 'All'], ['installed', 'Installed'], ['not-installed', 'Not installed']]} /><SelectField label="Sort by" value={sort} onChange={(value) => { setSort(sortOption(value)); setPage(1); }} options={[['updated', 'Recently updated'], ['name', 'Name A-Z'], ['version', 'Newest version']]} /></div><div className="mt-4 flex items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground"><span>{filtered.length === 0 ? 'No resources found' : `Showing ${(currentPage - 1) * PAGE_SIZE + 1}-${Math.min(currentPage * PAGE_SIZE, filtered.length)} of ${filtered.length}`}</span>{(query || review !== 'all' || installed !== 'all' || sort !== 'updated') && <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>}</div></div>
      {visible.length > 0 ? <><div className="mt-4 grid gap-4 md:grid-cols-2">{visible.map((resource) => { const id = resourceKey(resource); return <CatalogCard key={id} resource={resource} stagedAction={staged[id]?.action} installed={installedIds.has(id)} presentLocally={localIds.has(`${resource.type}/${resource.name}`)} onStage={() => select(resource)} />; })}</div>{pageCount > 1 && <div className="mt-6 flex items-center justify-between gap-4"><span className="text-xs text-muted-foreground">Page {currentPage} of {pageCount}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setPage(Math.max(1, currentPage - 1))}>Previous</Button><Button variant="outline" size="sm" disabled={currentPage === pageCount} onClick={() => setPage(Math.min(pageCount, currentPage + 1))}>Next</Button></div></div>}</> : <Card className="mt-5"><CardContent className="p-8"><MagnifyingGlass size={24} className="text-muted-foreground" /><h3 className="mt-3 font-semibold">{typeResources.length === 0 ? `No ${RESOURCE_TYPE_LABELS[activeType].toLowerCase()}s yet` : 'No matching resources'}</h3><p className="mt-2 text-sm text-muted-foreground">{typeResources.length === 0 ? 'Publish a resource to add it to this registry.' : 'Try a different search or filter.'}</p></CardContent></Card>}</section>}
  </div>;
}

function PageIntro() {
  return <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h1 id="catalog-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">Find the right resource for the next task.</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">Browse reviewed skills, agents, rules, servers, and tools. Stage changes together and apply them when the plan looks right.</p></div><Badge variant="outline">Local registry</Badge></div>;
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return <label className="block"><span className="text-sm font-medium">{label}</span><select className="mt-2 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" value={value} onChange={(event) => onChange(event.target.value)}>{options.map(([option, text]) => <option key={option} value={option}>{text}</option>)}</select></label>;
}

export function ResourcePage() {
  const params = useParams({ from: '/resources/$owner/$type/$name' });
  const resourceQuery = useQuery({ queryKey: ['resource', params.owner, params.type, params.name], queryFn: () => api.resource(params.owner, params.type, params.name) });
  const { staged, harnesses, stage, unstage } = useDirectory();
  const id = `${params.owner}/${params.type}/${params.name}`;
  const item = staged[id];
  const resource = resourceQuery.data?.resource;

  if (resourceQuery.isPending) return <LoadingCard />;
  if (resourceQuery.error || !resource) return <ErrorMessage message={resourceQuery.error instanceof Error ? resourceQuery.error.message : 'Resource not found.'} />;
  const version = resourceQuery.data.version;
  return <div className="space-y-8"><div><Link className="text-sm text-muted-foreground hover:text-foreground" to="/">← Back to catalog</Link><div className="mt-6 flex flex-col justify-between gap-5 sm:flex-row sm:items-start"><div><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{RESOURCE_TYPE_LABELS[resource.type]}</Badge><Badge variant={resource.reviewStatus === 'reviewed' ? 'success' : 'warning'}>{resource.reviewStatus === 'reviewed' ? 'Reviewed' : 'Unreviewed'}</Badge></div><h1 className="mt-3 text-3xl font-semibold tracking-tight">{resource.name}</h1><p className="mt-2 text-sm text-muted-foreground">{resource.owner} · v{resource.latestVersion} · Updated {updatedLabel(resource.updatedAt)}</p></div><Button variant={item ? 'secondary' : 'default'} onClick={() => item ? unstage(id) : stage({ key: id, resource: id, type: resource.type, action: 'install', harnesses: [...harnesses] })}>{item ? 'Staged in Changes' : 'Stage install'} <ArrowUpRight size={16} /></Button></div><p className="mt-6 max-w-3xl text-base leading-7 text-muted-foreground">{resource.description}</p></div>
    {resourceQuery.data.error && <ErrorMessage message={resourceQuery.data.error} />}{version ? <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileText size={18} /> Source files</CardTitle></CardHeader><CardContent className="space-y-2">{version.files.map((file, index) => <details className="overflow-hidden rounded-lg border" key={file.path} open={index === 0}><summary className="cursor-pointer px-3 py-2 text-sm font-medium hover:bg-muted/60"><code className="font-mono text-xs">{file.path}</code></summary><pre className="max-h-80 overflow-auto border-t bg-muted/40 p-4 text-xs leading-5"><code>{file.content}</code></pre></details>)}</CardContent></Card> : !resourceQuery.data.error && <Card><CardContent className="p-6"><p className="font-medium">No files found.</p><p className="mt-2 text-sm text-muted-foreground">The registry index points to a package with no readable files.</p></CardContent></Card>}
    <InstallPanel resource={resource} staged={item} />
  </div>;
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
    try { await navigator.clipboard.writeText(command); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); }
  }

  return <section aria-labelledby="install-title"><h2 id="install-title" className="text-xl font-semibold tracking-tight">Install this resource</h2><p className="mt-2 text-sm text-muted-foreground">Choose the target harnesses, then review the change plan before applying it.</p><Card className="mt-5"><CardContent className="space-y-6 p-5 sm:p-6"><fieldset><legend className="text-sm font-medium">Install in</legend><div className="mt-3 grid gap-2 sm:grid-cols-3">{harnessOptions.map((option) => <label className={cn('flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-3 text-sm transition-colors', selectedHarnesses.includes(option.value) ? 'border-primary/50 bg-primary/5' : 'border-border')} key={option.value}><input className="size-4 accent-primary" type="checkbox" checked={selectedHarnesses.includes(option.value)} onChange={(event) => toggleHarness(option.value, event.target.checked)} /><span>{option.label}</span></label>)}</div></fieldset>{resource.type === 'mcp-servers' && <fieldset className="border-t pt-5"><legend className="text-sm font-medium">Scope</legend><div className="mt-3 grid gap-2 sm:grid-cols-2">{scopeOptions.map((option) => <label className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 text-sm" key={option.value}><input className="mt-0.5 size-4 accent-primary" type="radio" name="resource-scope" checked={selectedScope === option.value} onChange={() => { setSelectedScope(option.value); setScope(option.value); }} /><span><span className="block font-medium">{option.label}</span><span className="mt-1 block text-xs text-muted-foreground">{option.hint}</span></span></label>)}</div></fieldset>}<div className="border-t pt-5"><div className="flex items-center gap-3 rounded-lg bg-muted px-3 py-2"><code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs">{command || 'Select at least one harness.'}</code><IconButton label="Copy install command" onClick={() => void copy()}>{copied ? <Check size={17} /> : <Copy size={17} />}</IconButton></div><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><span className="text-sm text-muted-foreground">{selectedHarnesses.length === 0 ? 'Select at least one harness.' : staged ? 'Saved in Changes.' : `${selectedHarnesses.length} harness${selectedHarnesses.length === 1 ? '' : 'es'} selected.`}</span><div className="flex gap-2">{staged && <Button variant="ghost" onClick={() => unstage(id)}>Remove</Button>}<Button onClick={save} disabled={selectedHarnesses.length === 0}>{staged ? 'Update Changes' : 'Add to Changes'} <ArrowUpRight size={16} /></Button></div></div></div></CardContent></Card></section>;
}

function ChangesSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { staged, plan, planLoading, planError, applyStatus, applyError, force, removeDependencies, setForce, setRemoveDependencies, unstage, updateStage, clear, busy, applyChanges, scope, setScope } = useDirectory();
  const items = Object.values(staged);
  const canApply = Boolean(plan && hasApplyableOperation(plan.plan) && (plan.plan.conflicts.length === 0 || force) && !busy);
  const operationCount = plan?.plan.operations.length ?? 0;
  return <SheetFrame open={open} onOpenChange={onOpenChange} title="Changes" description="Review the staged operations before they touch your local harness files."><div className="space-y-5 py-6">{items.length === 0 ? <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 text-sm text-muted-foreground"><Info className="mb-1 inline" size={17} /> Select resources from the catalog or an installed resource.</div> : <>{items.map((item) => <ChangeItem item={item} key={item.key} onRemove={() => unstage(item.key)} onUpdate={updateStage} disabled={busy} />)}<div className="flex justify-end"><Button variant="ghost" size="sm" onClick={clear}>Discard all</Button></div>{items.some((item) => item.type === 'mcp-servers') && <fieldset className="border-t pt-5"><legend className="text-sm font-medium">Default MCP scope</legend><div className="mt-3 grid gap-2 sm:grid-cols-2">{scopeOptions.map((option) => <label className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 text-sm" key={option.value}><input className="mt-0.5 size-4 accent-primary" type="radio" name="changes-scope" checked={scope === option.value} onChange={() => setScope(option.value)} /><span><span className="block font-medium">{option.label}</span><span className="mt-1 block text-xs text-muted-foreground">{option.hint}</span></span></label>)}</div></fieldset>}{planLoading && <LoadingCard />}{planError && <ErrorMessage message={planError} />}{applyError && <ErrorMessage message={applyError} />}{applyStatus && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-300" role="status">{applyStatus}</div>}{plan && <PlanSummary plan={plan.plan} />}{plan?.plan.conflicts.length ? <label className="flex items-center gap-2 text-sm"><input className="size-4 accent-primary" type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} /> Apply despite conflicts</label> : null}{plan?.plan.dependencyRemovals.length ? <label className="flex items-center gap-2 text-sm"><input className="size-4 accent-primary" type="checkbox" checked={removeDependencies} onChange={(event) => setRemoveDependencies(event.target.checked)} /> Remove unused dependencies</label> : null}<Button className="w-full" onClick={applyChanges} disabled={!canApply}>{busy ? 'Applying…' : plan && plan.plan.changes.length > 0 ? `Apply ${plan.plan.changes.length} file changes` : `Apply ${operationCount} operation${operationCount === 1 ? '' : 's'}`}</Button></>}</div></SheetFrame>;
}

function ChangeItem({ item, onRemove, onUpdate, disabled }: { item: StagedItem; onRemove: () => void; onUpdate: (item: StagedItem) => void; disabled: boolean }) {
  const { harnesses, scope } = useDirectory();
  const selected = item.harnesses.length > 0 ? item.harnesses : harnesses;
  return <div className="rounded-xl border p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{item.resource}</p><Badge className="mt-2" variant={item.action === 'install' ? 'success' : 'destructive'}>{item.action === 'install' ? 'Install' : 'Uninstall'}</Badge></div><IconButton label={`Remove ${item.resource}`} onClick={onRemove}><Trash size={17} /></IconButton></div><div className="mt-4 flex flex-wrap gap-2">{harnessOptions.map((option) => <label className="flex items-center gap-2 text-xs text-muted-foreground" key={option.value}><input className="size-4 accent-primary" type="checkbox" checked={selected.includes(option.value)} disabled={disabled} onChange={(event) => onUpdate({ ...item, harnesses: event.target.checked ? [...selected, option.value] : selected.filter((candidate) => candidate !== option.value) })} />{harnessLabel(option.value)}</label>)}</div>{item.type === 'mcp-servers' && <select className="mt-3 h-9 w-full rounded-md border bg-background px-2 text-xs" value={item.scope ?? scope} disabled={disabled} onChange={(event) => onUpdate({ ...item, scope: installScope(event.target.value) })}><option value="user">User scope</option><option value="project">Project scope</option></select>}</div>;
}

function PlanSummary({ plan }: { plan: ChangePlan }) {
  const changedResources = new Set(plan.changes.map((change) => change.resource));
  const recordOnlyOperations = plan.operations.filter((operation) => !changedResources.has(operation.resource));
  return <div className="space-y-3 rounded-xl border bg-muted/40 p-4"><div className="flex items-center justify-between gap-3"><p className="font-medium">Preview</p><Badge variant={plan.conflicts.length > 0 ? 'warning' : 'success'}>{plan.changes.length > 0 ? `${plan.changes.length} changes` : `${plan.operations.length} operations`}</Badge></div>{plan.conflicts.length > 0 && <div className="text-sm text-destructive"><strong>Conflicts:</strong> {plan.conflicts.join(' ')}</div>}{plan.warnings.length > 0 && <div className="text-sm text-amber-700 dark:text-amber-300">{plan.warnings.join(' ')}</div>}{recordOnlyOperations.length > 0 && <div className="space-y-1 border-t pt-3 text-xs text-muted-foreground"><p className="font-medium text-foreground">Installation records</p>{recordOnlyOperations.map((operation) => <p key={`${operation.resource}-${operation.action}`}><code className="font-mono">{operation.resource}</code> will be {operation.action === 'uninstall' ? 'removed' : 'updated'} without file changes.</p>)}</div>}<div className="max-h-80 space-y-2 overflow-y-auto border-t pt-3">{plan.changes.map((change) => <details className="rounded-lg border bg-background/60 p-2" key={`${change.path}-${change.harness}-${change.action}`}><summary className="flex cursor-pointer items-center gap-2 text-xs"><span className={cn('size-1.5 shrink-0 rounded-full', change.action === 'removed' ? 'bg-destructive' : change.action === 'added' ? 'bg-emerald-500' : 'bg-amber-500')} /><span className="min-w-0 flex-1 truncate"><code className="font-mono">{change.path}</code><span className="ml-2 text-muted-foreground">{change.resource} · {harnessLabel(change.harness)}</span></span><span className="shrink-0 text-muted-foreground">{change.action}</span></summary>{(change.before || change.after) && <pre className="mt-2 max-h-64 overflow-auto border-t pt-2 text-[11px] leading-5"><code>{change.action === 'modified' ? `Before:\n${change.before ?? '(file did not exist)'}\n\nAfter:\n${change.after ?? '(file will be removed)'}` : change.after ?? change.before}</code></pre>}</details>)}</div></div>;
}

function InstalledSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { localResources, localLoading, localRegistryError, homeDirectory, staged, harnesses, stage, unstage } = useDirectory();
  const queryClient = useQueryClient();
  const [harnessFilter, setHarnessFilter] = useState<HarnessFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const visibleResources = localResources.filter((resource) => {
    const matchesHarness = harnessFilter === 'all' || resource.harness === harnessFilter;
    const matchesSource = sourceFilter === 'all' || (sourceFilter === 'registry' ? resource.resource !== undefined : resource.resource === undefined);
    return matchesHarness && matchesSource;
  });

  function stageLocal(resource: LocalResource, action: Action) {
    if (!resource.resource) return;
    const id = resource.resource;
    const key = `${id}\u0000${resource.harness}`;
    if (staged[key]) {
      unstage(key);
      return;
    }
    const item: StagedItem = {
      key,
      resource: id,
      type: resource.type,
      action,
      harnesses: [resource.harness ?? harnesses[0] ?? 'claude-code'],
    };
    if (resource.type === 'mcp-servers') item.scope = resource.scope ?? 'user';
    stage(item);
  }
  const statusText = localLoading ? 'Scanning known harness locations…' : visibleResources.length === 0 ? 'No resources found in the known harness locations.' : `${visibleResources.length} local resource${visibleResources.length === 1 ? '' : 's'} found.`;
  return <SheetFrame open={open} onOpenChange={onOpenChange} title="Installed resources" description="Inspect resources found in your local harness directories."><div className="flex flex-wrap items-end justify-between gap-3 border-b pb-5 pt-5"><SelectField label="Harness" value={harnessFilter} onChange={(value) => setHarnessFilter(parseHarnessFilter(value))} options={[['all', 'All harnesses'], ['claude-code', 'Claude Code'], ['opencode', 'OpenCode'], ['codex', 'Codex']]} /><SelectField label="Source" value={sourceFilter} onChange={(value) => setSourceFilter(parseSourceFilter(value))} options={[['all', 'All sources'], ['registry', 'From this registry'], ['local', 'Not from this registry']]} /><Button variant="outline" size="sm" onClick={() => void queryClient.invalidateQueries({ queryKey: ['local-resources'] })} disabled={localLoading}><ArrowsClockwise size={16} className={cn(localLoading && 'animate-spin')} /> Refresh</Button></div><p className="pt-5 text-sm text-muted-foreground" role="status" aria-live="polite">{statusText}</p>{localRegistryError && <div className="pt-4"><ErrorMessage message={localRegistryError} /></div>}{localLoading ? <div className="space-y-3 py-6"><LoadingCard /></div> : <div className="space-y-3 py-6">{visibleResources.length === 0 ? <Card><CardContent className="p-5 text-sm text-muted-foreground">{localResources.length === 0 ? 'No local resources found.' : 'No local resources match these filters.'}</CardContent></Card> : visibleResources.map((resource) => { const key = resource.resource ? `${resource.resource}\u0000${resource.harness}` : ''; return <LocalResourceRow key={`${resource.harness}-${resource.path}`} resource={resource} homeDirectory={homeDirectory} staged={key ? staged[key] : undefined} onInstall={() => stageLocal(resource, 'install')} onUninstall={() => stageLocal(resource, 'uninstall')} onDiscard={() => key && unstage(key)} />; })}</div>}</SheetFrame>;
}

function LocalResourceRow({ resource, homeDirectory, staged, onInstall, onUninstall, onDiscard }: { resource: LocalResource; homeDirectory: string | undefined; staged: StagedItem | undefined; onInstall: () => void; onUninstall: () => void; onDiscard: () => void }) {
  const installLabel = resource.state === 'missing' || resource.state === 'modified' ? 'Reinstall' : 'Update';
  return <div className="rounded-xl border p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate font-medium">{resourceLabel(resource)}</p><Badge variant={resource.state === 'managed' ? 'success' : resource.state === 'unmanaged' ? 'muted' : 'warning'}>{LOCAL_STATE_LABELS[resource.state]}</Badge>{resource.resource && <Badge variant={resource.registryState === 'current' ? 'success' : resource.registryState === 'outdated' ? 'warning' : 'muted'}>{REGISTRY_STATE_LABELS[resource.registryState]}</Badge>}</div><p className="mt-1 text-xs text-muted-foreground">{resource.type} · {harnessLabel(resource.harness)}{resource.version ? ` · v${resource.version}` : ''}{resource.latestVersion && resource.latestVersion !== resource.version ? ` · latest v${resource.latestVersion}` : ''}</p></div>{resource.resource ? staged ? <div className="flex flex-wrap items-center gap-2"><Badge variant={staged.action === 'uninstall' ? 'destructive' : 'secondary'}>{staged.action === 'uninstall' ? 'Staged for uninstall' : 'Staged for install'}</Badge><Button variant="ghost" size="sm" onClick={onDiscard}>Discard</Button></div> : <div className="flex flex-wrap gap-2">{(resource.registryState === 'outdated' || resource.state === 'missing' || resource.state === 'modified') && <Button size="sm" onClick={onInstall}>{installLabel}</Button>}<Button variant="ghost" size="sm" onClick={onUninstall}>Uninstall</Button></div> : null}</div><p className="mt-3 truncate font-mono text-xs text-muted-foreground" title={resource.path}>{shortenHomePath(resource.path, homeDirectory)}</p>{resource.type === 'mcp-servers' && <p className="mt-2 text-xs text-muted-foreground">{resource.scope === 'project' ? 'Project scope' : 'User scope'}</p>}</div>;
}

function SettingsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { harnesses, setHarnesses } = useDirectory();
  const queryClient = useQueryClient();
  const config = useQuery({ queryKey: ['config'], queryFn: api.config, enabled: open });
  const [repository, setRepository] = useState<string | undefined>(undefined);
  const [configScope, setConfigScope] = useState<InstallScope>('user');
  const [theme, setTheme] = useState(() => readStorage<'light' | 'dark' | 'system'>('ai-directory-theme', 'system'));
  const systemDark = useSyncExternalStore(subscribeSystemTheme, getSystemTheme, getServerSystemTheme);
  const [status, setStatus] = useState('');
  const currentRepository = config.data?.repository ?? '';
  const sourceLabel = config.data?.source === 'none' ? 'Not configured' : config.data?.source ?? 'Loading';
  const saveMutation = useMutation({
    mutationFn: () => api.configPut(repository ?? currentRepository, configScope),
    onSuccess: (result) => {
      setStatus(result.source !== result.savedScope ? `Saved in the ${result.savedScope ?? configScope} config. The ${result.source} setting is still active.` : `Saved in the ${result.savedScope ?? configScope} config.`);
      void queryClient.invalidateQueries({ queryKey: ['config'] });
      void queryClient.invalidateQueries({ queryKey: ['registry'] });
    },
  });
  const clearMutation = useMutation({
    mutationFn: () => api.configDelete(configScope),
    onSuccess: (result) => {
      setRepository(undefined);
      setStatus(result.source !== 'none' && result.source !== result.clearedScope ? `Cleared the ${result.clearedScope ?? configScope} config. The ${result.source} setting is still active.` : `Cleared the ${result.clearedScope ?? configScope} config.`);
      void queryClient.invalidateQueries({ queryKey: ['config'] });
      void queryClient.invalidateQueries({ queryKey: ['registry'] });
    },
  });

  function chooseTheme(next: 'light' | 'dark' | 'system') {
    setTheme(next); writeStorage('ai-directory-theme', next); document.documentElement.classList.toggle('dark', next === 'dark' || (next === 'system' && systemDark)); document.documentElement.dataset.themePreference = next;
  }
  function save() { if ((repository ?? currentRepository).trim()) void saveMutation.mutateAsync(); }
  return <SheetFrame open={open} onOpenChange={onOpenChange} title="Settings" description="Set the registry source, default harnesses, and appearance."><div className="space-y-7 py-6"><section><div className="flex items-center justify-between gap-3"><h3 className="font-medium">Default harnesses</h3></div><p className="mt-1 text-sm text-muted-foreground">New staged resources use these harnesses.</p><div className="mt-3 space-y-2">{harnessOptions.map((option) => <label className="flex items-center gap-3 text-sm" key={option.value}><input className="size-4 accent-primary" type="checkbox" checked={harnesses.includes(option.value)} onChange={(event) => setHarnesses(event.target.checked ? [...harnesses, option.value] : harnesses.filter((item) => item !== option.value))} />{option.label}</label>)}</div></section><Separator /><section><div className="flex items-center justify-between gap-3"><h3 className="font-medium">Registry source</h3><Badge variant={sourceLabel === 'Not configured' ? 'muted' : 'outline'}>{sourceLabel}</Badge></div><p className="mt-1 text-sm text-muted-foreground">The repository setting is stored by the local API.</p><Label className="mt-4 block" htmlFor="registry-repository">Git repository URL</Label><Input id="registry-repository" className="mt-2" placeholder="https://github.com/org/resources" value={repository ?? currentRepository} onChange={(event) => setRepository(event.target.value)} /><div className="mt-3 flex gap-2"><SelectField label="Save scope" value={configScope} onChange={(value) => setConfigScope(installScope(value))} options={[['user', 'User config'], ['project', 'Project config']]} /></div><div className="mt-4 flex gap-2"><Button onClick={save} disabled={!(repository ?? currentRepository).trim() || saveMutation.isPending}>Save source</Button><Button variant="ghost" onClick={() => void clearMutation.mutateAsync()} disabled={clearMutation.isPending}>Clear</Button></div>{status && <p className="mt-3 text-sm text-muted-foreground" role="status">{status}</p>}{(saveMutation.error || clearMutation.error) && <p className="mt-3 text-sm text-destructive" role="alert">{(saveMutation.error ?? clearMutation.error) instanceof Error ? (saveMutation.error ?? clearMutation.error)?.message : 'Could not update the registry source.'}</p>}</section><Separator /><section><h3 className="font-medium">Appearance</h3><div className="mt-3 grid grid-cols-3 gap-2">{(['system', 'light', 'dark'] as const).map((value) => <Button key={value} variant={theme === value ? 'secondary' : 'outline'} size="sm" onClick={() => chooseTheme(value)}>{value.slice(0, 1).toUpperCase() + value.slice(1)}</Button>)}</div></section></div></SheetFrame>;
}

function PublishSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [owner, setOwner] = useState('');
  const [type, setType] = useState<ResourceType>('skills');
  const [name, setName] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<DirectoryFile[]>([]);
  const [review, setReview] = useState<PublishReview | null>(null);
  const [message, setMessage] = useState('Loading GitHub username…');
  const [pullRequestUrl, setPullRequestUrl] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const userQuery = useQuery({ queryKey: ['github-user'], queryFn: api.githubUser, enabled: open && owner.length === 0 });
  const validateMutation = useMutation({ mutationFn: (body: FormData) => api.validate(body) });
  const submitMutation = useMutation({ mutationFn: (body: FormData) => api.submit(body) });
  const resolvedOwner = owner || userQuery.data?.username || '';
  function resetValidation() {
    setReview(null);
    setPullRequestUrl('');
    setSubmitted(false);
    setMessage('Ready to validate.');
  }

  function pathFor(file: DirectoryFile) {
    const path = file.webkitRelativePath || file.name;
    const parts = path.split('/');
    return parts.length > 1 ? parts.slice(1).join('/') : path;
  }

  function formData() {
    const body = new FormData();
    body.set('resourceId', [resolvedOwner.trim(), type, name.trim()].join('/'));
    body.set('version', version.trim());
    if (description.trim()) body.set('description', description.trim());
    for (const file of files) body.append('files[]', file, pathFor(file));
    return body;
  }

  async function validate() {
    if (files.length === 0) {
      setMessage('Choose a resource folder first.');
      return;
    }
    if (!resolvedOwner.trim()) {
      setMessage('The authenticated GitHub username is required.');
      return;
    }
    resetValidation();
    try {
      const result = await validateMutation.mutateAsync(formData());
      const nextReview: PublishReview = {
        resource: result.resource,
        version: result.version,
        description: (result.description ?? '').trim(),
        entryFile: result.entryFile,
        files: result.files,
      };
      setReview(nextReview);
      setDescription(nextReview.description);
      setMessage('Validation passed. Review the files, then submit the pull request.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Validation failed.');
    }
  }

  async function submit() {
    if (!review || submitted || !window.confirm('Create this pull request?')) return;
    setMessage('Creating pull request…');
    try {
      const result = await submitMutation.mutateAsync(formData());
      setPullRequestUrl(result.pullRequestUrl);
      setSubmitted(true);
      setMessage(result.pullRequestUrl ? 'Pull request created.' : 'Pull request created without a URL.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Submit failed.');
    }
  }

  function updateField(update: () => void) {
    update();
    resetValidation();
  }

  const paths = files.map(pathFor).sort();
  const folder = files[0]?.webkitRelativePath?.split('/')[0];
  const reviewDescription = description.trim() || 'Not found';
  const busy = validateMutation.isPending || submitMutation.isPending;
  const userStatus = userQuery.isPending ? 'Loading GitHub username…' : userQuery.error instanceof Error ? userQuery.error.message : message;

  return <SheetFrame open={open} onOpenChange={onOpenChange} title="Publish resource" description="Validate a resource folder and submit it for review."><div className="space-y-8 py-6"><form className="space-y-8" onSubmit={(event) => { event.preventDefault(); void validate(); }}><fieldset className="rounded-xl border bg-muted/20 p-4 sm:p-5"><legend className="px-2 text-base font-semibold">Resource identity</legend><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_10rem]"><div><Label htmlFor="publish-owner">GitHub user</Label><Input id="publish-owner" className="mt-2" type="text" value={owner || userQuery.data?.username || ''} placeholder="Loading…" onChange={(event) => updateField(() => setOwner(event.target.value))} disabled={!userQuery.error || busy} /></div><div><Label htmlFor="publish-type">Type</Label><select id="publish-type" className="mt-2 flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-2 focus-visible:outline-ring" value={type} onChange={(event) => updateField(() => setType(resourceType(event.target.value)))} required disabled={busy}>{RESOURCE_TYPES.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></div><div className="sm:col-span-2 lg:col-span-1"><Label htmlFor="publish-name">Name</Label><Input id="publish-name" className="mt-2" value={name} placeholder="my-resource" onChange={(event) => updateField(() => setName(event.target.value))} autoComplete="off" required disabled={busy} /></div><div><Label htmlFor="publish-version">Version</Label><Input id="publish-version" className="mt-2" value={version} onChange={(event) => updateField(() => setVersion(event.target.value))} autoComplete="off" required disabled={busy} /></div></div><output className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg bg-background px-3 py-2" aria-live="polite"><span className="text-xs font-medium text-muted-foreground">Resource ID</span><code className="break-all font-mono text-xs">{resolvedOwner ? [resolvedOwner, type, name].join('/') : 'Loading GitHub user…'}</code></output></fieldset><fieldset><legend className="text-base font-semibold">Resource files</legend><p className="mt-2 text-sm text-muted-foreground">Choose the folder that contains the resource files.</p><input className="mt-3 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-primary file:px-3 file:py-1 file:text-primary-foreground" type="file" multiple required aria-label="Resource files directory" ref={(element) => element?.setAttribute('webkitdirectory', '')} onChange={(event) => { setFiles(Array.from(event.currentTarget.files ?? [])); resetValidation(); }} disabled={busy} /><div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Badge variant="muted">{paths.length} file{paths.length === 1 ? '' : 's'}</Badge>{folder && <span>Folder: {folder}</span>}</div>{paths.length > 0 ? <div className="mt-4 rounded-xl border bg-muted/20 p-4" aria-live="polite"><p className="text-sm font-semibold">Files to publish</p><ul className="mt-3 max-h-40 overflow-y-auto font-mono text-xs text-muted-foreground">{paths.slice(0, 12).map((path) => <li className="py-1" key={path}>{path}</li>)}{paths.length > 12 && <li className="py-1">…and {paths.length - 12} more</li>}</ul></div> : <div className="mt-4 rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 text-sm text-muted-foreground" role="status"><Info className="mr-2 inline" size={17} /> No resource folder selected.</div>}</fieldset>{review && <fieldset className="rounded-xl border bg-muted/20 p-4 sm:p-5"><legend className="px-2 text-base font-semibold">Description</legend><p className="text-sm text-muted-foreground">Inferred from the resource files. Edit it before submitting if needed.</p><textarea className="mt-3 min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-2 focus-visible:outline-ring" rows={3} value={description} placeholder="Resource description" onChange={(event) => setDescription(event.target.value)} disabled={busy} /></fieldset>}<div className="border-t pt-5"><div className="flex flex-wrap gap-3"><Button variant={review ? 'outline' : 'default'} type="submit" disabled={busy}>{validateMutation.isPending ? 'Validating…' : 'Validate resource'}</Button>{review && <Button type="button" onClick={() => void submit()} disabled={busy || submitted}>{submitMutation.isPending ? 'Creating pull request…' : submitted ? 'Pull request created' : 'Submit pull request'}</Button>}</div><div className={cn('mt-4 rounded-lg border p-3 text-sm', userQuery.error || validateMutation.error || submitMutation.error ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'border-blue-500/30 bg-blue-500/5 text-muted-foreground')} role="status" aria-live="polite"><Info className="mr-2 inline" size={17} /> {userStatus}</div></div></form>{review && <section className="rounded-xl border bg-muted/20 p-5 sm:p-6" aria-labelledby="publish-review-title"><div className="flex flex-wrap items-start justify-between gap-4"><div><h3 id="publish-review-title" className="text-lg font-semibold tracking-tight">Ready to submit</h3><p className="mt-1 text-sm text-muted-foreground">Check these details before creating the pull request.</p></div><Badge variant="success">Validated</Badge></div><dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-xs font-medium text-muted-foreground">Resource</dt><dd className="mt-1 break-all font-mono text-xs">{review.resource}</dd></div><div><dt className="text-xs font-medium text-muted-foreground">Version</dt><dd className="mt-1">{review.version}</dd></div><div><dt className="text-xs font-medium text-muted-foreground">Entry file</dt><dd className="mt-1 break-all font-mono text-xs">{review.entryFile}</dd></div><div><dt className="text-xs font-medium text-muted-foreground">Files</dt><dd className="mt-1">{review.files.length} file{review.files.length === 1 ? '' : 's'}</dd></div><div className="sm:col-span-2"><dt className="text-xs font-medium text-muted-foreground">Description</dt><dd className="mt-1 leading-6">{reviewDescription}</dd></div></dl><p className="mt-6 text-sm leading-6 text-muted-foreground">The pull request stays unreviewed until the curation team reviews and merges it.</p>{pullRequestUrl && <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-300"><Check className="mr-2 inline" size={17} /><a className="font-semibold underline underline-offset-4" href={pullRequestUrl} target="_blank" rel="noreferrer">Open pull request</a></div>}</section>}</div></SheetFrame>;
}
