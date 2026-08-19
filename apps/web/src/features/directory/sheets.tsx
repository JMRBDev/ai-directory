import { useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowsClockwise } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { Check } from '@phosphor-icons/react/dist/csr/Check';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../../components/ui/accordion';
import { Info } from '@phosphor-icons/react/dist/csr/Info';
import { Trash } from '@phosphor-icons/react/dist/csr/Trash';
import { api } from '../../lib/api';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Checkbox } from '../../components/ui/checkbox';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { RadioGroup, RadioGroupItem } from '../../components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Separator } from '../../components/ui/separator';
import { Textarea } from '../../components/ui/textarea';
import {
  harnessLabel,
  harnessOptions,
  resourceLabel,
  scopeOptions,
  shortenHomePath,
  type Action,
  type ChangePlan,
  type InstallScope,
  type LocalResource,
  type StagedItem,
} from '../../lib/types';
import { cn } from '../../lib/utils';
import { useDirectory } from './context';
import { ErrorMessage, LoadingCard, SheetFrame } from './common';
import {
  getServerSystemTheme,
  getSystemTheme,
  hasApplyableOperation,
  installScope,
  LOCAL_STATE_LABELS,
  parseHarnessFilter,
  parseSourceFilter,
  readStorage,
  REGISTRY_STATE_LABELS,
  RESOURCE_TYPES,
  resourceType,
  subscribeSystemTheme,
  writeStorage,
  type DirectoryFile,
  type HarnessFilter,
  type PublishReview,
  type SourceFilter,
} from './model';

export function ChangesSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const {
    staged,
    plan,
    planLoading,
    planError,
    applyStatus,
    applyError,
    force,
    removeDependencies,
    setForce,
    setRemoveDependencies,
    unstage,
    updateStage,
    clear,
    busy,
    applyChanges,
    scope,
    setScope,
  } = useDirectory();
  const items = Object.values(staged);
  const canApply = Boolean(plan && hasApplyableOperation(plan.plan) && (plan.plan.conflicts.length === 0 || force) && !busy);
  const operationCount = plan?.plan.operations.length ?? 0;

  return (
    <SheetFrame open={open} onOpenChange={onOpenChange} title="Changes" description="Review the staged operations before they touch your local harness files.">
      <div className="space-y-5 py-6">
        {items.length === 0 ? (
          <Alert className="border-blue-500/30 bg-blue-500/5 text-muted-foreground">
            <Info size={17} />
            <AlertDescription>Select resources from the catalog or an installed resource.</AlertDescription>
          </Alert>
        ) : (
          <>
            {items.map((item) => (
              <ChangeItem item={item} key={item.key} onRemove={() => unstage(item.key)} onUpdate={updateStage} disabled={busy} />
            ))}
            <div className="flex justify-end"><Button variant="ghost" size="sm" onClick={clear}>Discard all</Button></div>
            {items.some((item) => item.type === 'mcp-servers') && (
              <div className="border-t pt-5">
                <Label className="text-sm font-medium">Default MCP scope</Label>
                <RadioGroup className="mt-3 grid gap-2 sm:grid-cols-2" value={scope} onValueChange={(value) => setScope(installScope(value))}>
                  {scopeOptions.map((option) => (
                    <Label className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 text-sm" htmlFor={`changes-scope-${option.value}`} key={option.value}>
                      <RadioGroupItem className="mt-0.5" id={`changes-scope-${option.value}`} value={option.value} />
                      <span><span className="block font-medium">{option.label}</span><span className="mt-1 block text-xs text-muted-foreground">{option.hint}</span></span>
                    </Label>
                  ))}
                </RadioGroup>
              </div>
            )}
            {planLoading && <LoadingCard />}
            {planError && <ErrorMessage message={planError} />}
            {applyError && <ErrorMessage message={applyError} />}
            {applyStatus && <Alert className="border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"><AlertDescription>{applyStatus}</AlertDescription></Alert>}
            {plan && <PlanSummary plan={plan.plan} />}
            {plan?.plan.conflicts.length ? <Label className="flex items-center gap-2 text-sm" htmlFor="changes-force"><Checkbox id="changes-force" checked={force} onCheckedChange={(checked) => setForce(checked === true)} /> Apply despite conflicts</Label> : null}
            {plan?.plan.dependencyRemovals.length ? <Label className="flex items-center gap-2 text-sm" htmlFor="changes-remove-dependencies"><Checkbox id="changes-remove-dependencies" checked={removeDependencies} onCheckedChange={(checked) => setRemoveDependencies(checked === true)} /> Remove unused dependencies</Label> : null}
            <Button className="w-full" onClick={applyChanges} disabled={!canApply}>
              {busy ? 'Applying…' : plan && plan.plan.changes.length > 0 ? `Apply ${plan.plan.changes.length} file changes` : `Apply ${operationCount} operation${operationCount === 1 ? '' : 's'}`}
            </Button>
          </>
        )}
      </div>
    </SheetFrame>
  );
}

function ChangeItem({ item, onRemove, onUpdate, disabled }: { item: StagedItem; onRemove: () => void; onUpdate: (item: StagedItem) => void; disabled: boolean }) {
  const { harnesses, scope } = useDirectory();
  const selected = item.harnesses.length > 0 ? item.harnesses : harnesses;

  return (
    <div className="rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{item.resource}</p>
          <Badge className="mt-2" variant={item.action === 'install' ? 'success' : 'destructive'}>{item.action === 'install' ? 'Install' : 'Uninstall'}</Badge>
        </div>
        <Button variant="ghost" size="icon" aria-label={`Remove ${item.resource}`} title={`Remove ${item.resource}`} onClick={onRemove}><Trash size={17} /></Button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {harnessOptions.map((option) => (
          <Label className="flex items-center gap-2 text-xs text-muted-foreground" htmlFor={`change-${item.key}-${option.value}`} key={option.value}>
            <Checkbox id={`change-${item.key}-${option.value}`} checked={selected.includes(option.value)} disabled={disabled} onCheckedChange={(checked) => onUpdate({ ...item, harnesses: checked === true ? [...selected, option.value] : selected.filter((candidate) => candidate !== option.value) })} />
            {harnessLabel(option.value)}
          </Label>
        ))}
      </div>
      {item.type === 'mcp-servers' && (
        <Select value={item.scope ?? scope} onValueChange={(value) => onUpdate({ ...item, scope: installScope(value) })} disabled={disabled}>
          <SelectTrigger className="mt-3"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="user">User scope</SelectItem><SelectItem value="project">Project scope</SelectItem></SelectContent>
        </Select>
      )}
    </div>
  );
}

function PlanSummary({ plan }: { plan: ChangePlan }) {
  const changedResources = new Set(plan.changes.map((change) => change.resource));
  const recordOnlyOperations = plan.operations.filter((operation) => !changedResources.has(operation.resource));

  return (
    <div className="space-y-3 rounded-xl border bg-muted/40 p-4">
      <div className="flex items-center justify-between gap-3"><p className="font-medium">Preview</p><Badge variant={plan.conflicts.length > 0 ? 'warning' : 'success'}>{plan.changes.length > 0 ? `${plan.changes.length} changes` : `${plan.operations.length} operations`}</Badge></div>
      {plan.conflicts.length > 0 && <div className="text-sm text-destructive"><strong>Conflicts:</strong> {plan.conflicts.join(' ')}</div>}
      {plan.warnings.length > 0 && <div className="text-sm text-amber-700 dark:text-amber-300">{plan.warnings.join(' ')}</div>}
      {recordOnlyOperations.length > 0 && <div className="space-y-1 border-t pt-3 text-xs text-muted-foreground"><p className="font-medium text-foreground">Installation records</p>{recordOnlyOperations.map((operation) => <p key={`${operation.resource}-${operation.action}`}><code className="font-mono">{operation.resource}</code> will be {operation.action === 'uninstall' ? 'removed' : 'updated'} without file changes.</p>)}</div>}
      <Accordion type="multiple" className="max-h-80 overflow-y-auto border-t pt-3">
        {plan.changes.map((change) => (
          <AccordionItem className="rounded-lg border bg-background/60 px-2" key={`${change.path}-${change.harness}-${change.action}`} value={`${change.path}-${change.harness}-${change.action}`}>
            <AccordionTrigger className="gap-2 py-2 text-xs hover:no-underline">
              <span className={cn('size-1.5 shrink-0 rounded-full', change.action === 'removed' ? 'bg-destructive' : change.action === 'added' ? 'bg-emerald-500' : 'bg-amber-500')} />
              <span className="min-w-0 flex-1 truncate"><code className="font-mono">{change.path}</code><span className="ml-2 text-muted-foreground">{change.resource} · {harnessLabel(change.harness)}</span></span>
              <span className="shrink-0 text-muted-foreground">{change.action}</span>
            </AccordionTrigger>
            {(change.before || change.after) && <AccordionContent className="border-t pt-2"><pre className="max-h-64 overflow-auto text-[11px] leading-5"><code>{change.action === 'modified' ? `Before:\n${change.before ?? '(file did not exist)'}\n\nAfter:\n${change.after ?? '(file will be removed)'}` : change.after ?? change.before}</code></pre></AccordionContent>}
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}

export function InstalledSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
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

  const statusText = localLoading
    ? 'Scanning known harness locations…'
    : visibleResources.length === 0
      ? 'No resources found in the known harness locations.'
      : `${visibleResources.length} local resource${visibleResources.length === 1 ? '' : 's'} found.`;

  return (
    <SheetFrame open={open} onOpenChange={onOpenChange} title="Installed resources" description="Inspect resources found in your local harness directories.">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-5 pt-5">
        <div>
          <Label htmlFor="installed-harness">Harness</Label>
          <Select value={harnessFilter} onValueChange={(value) => setHarnessFilter(parseHarnessFilter(value))}>
            <SelectTrigger id="installed-harness" className="mt-2"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All harnesses</SelectItem><SelectItem value="claude-code">Claude Code</SelectItem><SelectItem value="opencode">OpenCode</SelectItem><SelectItem value="codex">Codex</SelectItem></SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="installed-source">Source</Label>
          <Select value={sourceFilter} onValueChange={(value) => setSourceFilter(parseSourceFilter(value))}>
            <SelectTrigger id="installed-source" className="mt-2"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All sources</SelectItem><SelectItem value="registry">From this registry</SelectItem><SelectItem value="local">Not from this registry</SelectItem></SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" onClick={() => void queryClient.invalidateQueries({ queryKey: ['local-resources'] })} disabled={localLoading}><ArrowsClockwise size={16} className={cn(localLoading && 'animate-spin')} /> Refresh</Button>
      </div>
      <p className="pt-5 text-sm text-muted-foreground" role="status" aria-live="polite">{statusText}</p>
      {localRegistryError && <div className="pt-4"><ErrorMessage message={localRegistryError} /></div>}
      {localLoading ? <div className="space-y-3 py-6"><LoadingCard /></div> : <div className="space-y-3 py-6">{visibleResources.length === 0 ? <Card><CardContent className="p-5 text-sm text-muted-foreground">{localResources.length === 0 ? 'No local resources found.' : 'No local resources match these filters.'}</CardContent></Card> : visibleResources.map((resource) => { const key = resource.resource ? `${resource.resource}\u0000${resource.harness}` : ''; return <LocalResourceRow key={`${resource.harness}-${resource.path}`} resource={resource} homeDirectory={homeDirectory} staged={key ? staged[key] : undefined} onInstall={() => stageLocal(resource, 'install')} onUninstall={() => stageLocal(resource, 'uninstall')} onDiscard={() => key && unstage(key)} />; })}</div>}
    </SheetFrame>
  );
}

function LocalResourceRow({ resource, homeDirectory, staged, onInstall, onUninstall, onDiscard }: { resource: LocalResource; homeDirectory: string | undefined; staged: StagedItem | undefined; onInstall: () => void; onUninstall: () => void; onDiscard: () => void }) {
  const installLabel = resource.state === 'missing' || resource.state === 'modified' ? 'Reinstall' : 'Update';
  return <div className="rounded-xl border p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate font-medium">{resourceLabel(resource)}</p><Badge variant={resource.state === 'managed' ? 'success' : resource.state === 'unmanaged' ? 'muted' : 'warning'}>{LOCAL_STATE_LABELS[resource.state]}</Badge>{resource.resource && <Badge variant={resource.registryState === 'current' ? 'success' : resource.registryState === 'outdated' ? 'warning' : 'muted'}>{REGISTRY_STATE_LABELS[resource.registryState]}</Badge>}</div><p className="mt-1 text-xs text-muted-foreground">{resource.type} · {harnessLabel(resource.harness)}{resource.version ? ` · v${resource.version}` : ''}{resource.latestVersion && resource.latestVersion !== resource.version ? ` · latest v${resource.latestVersion}` : ''}</p></div>{resource.resource ? staged ? <div className="flex flex-wrap items-center gap-2"><Badge variant={staged.action === 'uninstall' ? 'destructive' : 'secondary'}>{staged.action === 'uninstall' ? 'Staged for uninstall' : 'Staged for install'}</Badge><Button variant="ghost" size="sm" onClick={onDiscard}>Discard</Button></div> : <div className="flex flex-wrap gap-2">{(resource.registryState === 'outdated' || resource.state === 'missing' || resource.state === 'modified') && <Button size="sm" onClick={onInstall}>{installLabel}</Button>}<Button variant="ghost" size="sm" onClick={onUninstall}>Uninstall</Button></div> : null}</div><p className="mt-3 truncate font-mono text-xs text-muted-foreground" title={resource.path}>{shortenHomePath(resource.path, homeDirectory)}</p>{resource.type === 'mcp-servers' && <p className="mt-2 text-xs text-muted-foreground">{resource.scope === 'project' ? 'Project scope' : 'User scope'}</p>}</div>;
}

export function SettingsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
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
    setTheme(next);
    writeStorage('ai-directory-theme', next);
    document.documentElement.classList.toggle('dark', next === 'dark' || (next === 'system' && systemDark));
    document.documentElement.dataset.themePreference = next;
  }

  function save() {
    if ((repository ?? currentRepository).trim()) void saveMutation.mutateAsync();
  }

  return (
    <SheetFrame open={open} onOpenChange={onOpenChange} title="Settings" description="Set the registry source, default harnesses, and appearance.">
      <div className="space-y-7 py-6">
        <section>
          <h3 className="font-medium">Default harnesses</h3>
          <p className="mt-1 text-sm text-muted-foreground">New staged resources use these harnesses.</p>
          <div className="mt-3 space-y-2">{harnessOptions.map((option) => <Label className="flex items-center gap-3 text-sm" htmlFor={`settings-harness-${option.value}`} key={option.value}><Checkbox id={`settings-harness-${option.value}`} checked={harnesses.includes(option.value)} onCheckedChange={(checked) => setHarnesses(checked === true ? [...harnesses, option.value] : harnesses.filter((item) => item !== option.value))} />{option.label}</Label>)}</div>
        </section>
        <Separator />
        <section>
          <div className="flex items-center justify-between gap-3"><h3 className="font-medium">Registry source</h3><Badge variant={sourceLabel === 'Not configured' ? 'muted' : 'outline'}>{sourceLabel}</Badge></div>
          <p className="mt-1 text-sm text-muted-foreground">The repository setting is stored by the local API.</p>
          <Label className="mt-4 block" htmlFor="registry-repository">Git repository URL</Label>
          <Input id="registry-repository" className="mt-2" placeholder="https://github.com/org/resources" value={repository ?? currentRepository} onChange={(event) => setRepository(event.target.value)} />
          <div className="mt-3">
            <Label htmlFor="settings-scope">Save scope</Label>
            <Select value={configScope} onValueChange={(value) => setConfigScope(installScope(value))}>
              <SelectTrigger id="settings-scope" className="mt-2"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="user">User config</SelectItem><SelectItem value="project">Project config</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="mt-4 flex gap-2"><Button onClick={save} disabled={!(repository ?? currentRepository).trim() || saveMutation.isPending}>Save source</Button><Button variant="ghost" onClick={() => void clearMutation.mutateAsync()} disabled={clearMutation.isPending}>Clear</Button></div>
          {status && <p className="mt-3 text-sm text-muted-foreground" role="status">{status}</p>}
          {(saveMutation.error || clearMutation.error) && <p className="mt-3 text-sm text-destructive" role="alert">{(saveMutation.error ?? clearMutation.error) instanceof Error ? (saveMutation.error ?? clearMutation.error)?.message : 'Could not update the registry source.'}</p>}
        </section>
        <Separator />
        <section>
          <h3 className="font-medium">Appearance</h3>
          <div className="mt-3 grid grid-cols-3 gap-2">{(['system', 'light', 'dark'] as const).map((value) => <Button key={value} variant={theme === value ? 'secondary' : 'outline'} size="sm" onClick={() => chooseTheme(value)}>{value.slice(0, 1).toUpperCase() + value.slice(1)}</Button>)}</div>
        </section>
      </div>
    </SheetFrame>
  );
}

export function PublishSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [owner, setOwner] = useState('');
  const [type, setType] = useState<import('../../lib/types').ResourceType>('skills');
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
      const nextReview: PublishReview = { resource: result.resource, version: result.version, description: (result.description ?? '').trim(), entryFile: result.entryFile, files: result.files };
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

  return (
    <SheetFrame open={open} onOpenChange={onOpenChange} title="Publish resource" description="Validate a resource folder and submit it for review.">
      <div className="space-y-8 py-6">
        <form className="space-y-8" onSubmit={(event) => { event.preventDefault(); void validate(); }}>
          <Card className="bg-muted/20 p-4 sm:p-5">
            <CardHeader className="p-0"><CardTitle className="text-base">Resource identity</CardTitle></CardHeader>
            <CardContent className="p-0 pt-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_10rem]">
                <div><Label htmlFor="publish-owner">GitHub user</Label><Input id="publish-owner" className="mt-2" type="text" value={owner || userQuery.data?.username || ''} placeholder="Loading…" onChange={(event) => updateField(() => setOwner(event.target.value))} disabled={!userQuery.error || busy} /></div>
                <div><Label htmlFor="publish-type">Type</Label><Select value={type} onValueChange={(value) => updateField(() => setType(resourceType(value)))} disabled={busy}><SelectTrigger id="publish-type" className="mt-2"><SelectValue /></SelectTrigger><SelectContent>{RESOURCE_TYPES.map((option) => <SelectItem value={option.value} key={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
                <div className="sm:col-span-2 lg:col-span-1"><Label htmlFor="publish-name">Name</Label><Input id="publish-name" className="mt-2" value={name} placeholder="my-resource" onChange={(event) => updateField(() => setName(event.target.value))} autoComplete="off" required disabled={busy} /></div>
                <div><Label htmlFor="publish-version">Version</Label><Input id="publish-version" className="mt-2" value={version} onChange={(event) => updateField(() => setVersion(event.target.value))} autoComplete="off" required disabled={busy} /></div>
              </div>
              <output className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg bg-background px-3 py-2" aria-live="polite"><span className="text-xs font-medium text-muted-foreground">Resource ID</span><code className="break-all font-mono text-xs">{resolvedOwner ? [resolvedOwner, type, name].join('/') : 'Loading GitHub user…'}</code></output>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-0"><CardTitle className="text-base">Resource files</CardTitle><CardDescription className="mt-2">Choose the folder that contains the resource files.</CardDescription></CardHeader>
            <CardContent className="p-0 pt-4">
              <Input className="mt-3" type="file" multiple required aria-label="Resource files directory" ref={(element) => element?.setAttribute('webkitdirectory', '')} onChange={(event) => { setFiles(Array.from(event.currentTarget.files ?? [])); resetValidation(); }} disabled={busy} />
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Badge variant="muted">{paths.length} file{paths.length === 1 ? '' : 's'}</Badge>{folder && <span>Folder: {folder}</span>}</div>
              {paths.length > 0 ? <div className="mt-4 rounded-xl border bg-muted/20 p-4" aria-live="polite"><p className="text-sm font-semibold">Files to publish</p><ul className="mt-3 max-h-40 overflow-y-auto font-mono text-xs text-muted-foreground">{paths.slice(0, 12).map((path) => <li className="py-1" key={path}>{path}</li>)}{paths.length > 12 && <li className="py-1">…and {paths.length - 12} more</li>}</ul></div> : <Alert className="mt-4 border-blue-500/30 bg-blue-500/5 text-muted-foreground"><Info size={17} /><AlertDescription>No resource folder selected.</AlertDescription></Alert>}
            </CardContent>
          </Card>
          {review && <Card className="bg-muted/20 p-4 sm:p-5"><CardHeader className="p-0"><CardTitle className="text-base">Description</CardTitle><CardDescription className="mt-2">Inferred from the resource files. Edit it before submitting if needed.</CardDescription></CardHeader><CardContent className="p-0 pt-4"><Textarea rows={3} value={description} placeholder="Resource description" onChange={(event) => setDescription(event.target.value)} disabled={busy} /></CardContent></Card>}
          <div className="border-t pt-5">
            <div className="flex flex-wrap gap-3"><Button variant={review ? 'outline' : 'default'} type="submit" disabled={busy}>{validateMutation.isPending ? 'Validating…' : 'Validate resource'}</Button>{review && <Button type="button" onClick={() => void submit()} disabled={busy || submitted}>{submitMutation.isPending ? 'Creating pull request…' : submitted ? 'Pull request created' : 'Submit pull request'}</Button>}</div>
            <Alert className={cn('mt-4 border p-3', userQuery.error || validateMutation.error || submitMutation.error ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'border-blue-500/30 bg-blue-500/5 text-muted-foreground')} role="status" aria-live="polite"><Info size={17} /><AlertDescription>{userStatus}</AlertDescription></Alert>
          </div>
        </form>
        {review && <section className="rounded-xl border bg-muted/20 p-5 sm:p-6" aria-labelledby="publish-review-title"><div className="flex flex-wrap items-start justify-between gap-4"><div><h3 id="publish-review-title" className="text-lg font-semibold tracking-tight">Ready to submit</h3><p className="mt-1 text-sm text-muted-foreground">Check these details before creating the pull request.</p></div><Badge variant="success">Validated</Badge></div><dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-xs font-medium text-muted-foreground">Resource</dt><dd className="mt-1 break-all font-mono text-xs">{review.resource}</dd></div><div><dt className="text-xs font-medium text-muted-foreground">Version</dt><dd className="mt-1">{review.version}</dd></div><div><dt className="text-xs font-medium text-muted-foreground">Entry file</dt><dd className="mt-1 break-all font-mono text-xs">{review.entryFile}</dd></div><div><dt className="text-xs font-medium text-muted-foreground">Files</dt><dd className="mt-1">{review.files.length} file{review.files.length === 1 ? '' : 's'}</dd></div><div className="sm:col-span-2"><dt className="text-xs font-medium text-muted-foreground">Description</dt><dd className="mt-1 leading-6">{reviewDescription}</dd></div></dl><p className="mt-6 text-sm leading-6 text-muted-foreground">The pull request stays unreviewed until the curation team reviews and merges it.</p>{pullRequestUrl && <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-300"><Check className="mr-2 inline" size={17} /><a className="font-semibold underline underline-offset-4" href={pullRequestUrl} target="_blank" rel="noreferrer">Open pull request</a></div>}</section>}
      </div>
    </SheetFrame>
  );
}
