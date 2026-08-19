import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowsClockwise } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { Info } from '@phosphor-icons/react/dist/csr/Info';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../../components/ui/empty';
import { Field, FieldLabel } from '../../components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { cn } from '../../lib/utils';
import { harnessLabel, resourceLabel, shortenHomePath, type Action, type LocalResource, type StagedItem } from '../../lib/types';
import { ErrorMessage, LoadingCard, SheetFrame } from './common';
import { useDirectory } from './context';
import { LOCAL_STATE_LABELS, parseHarnessFilter, parseSourceFilter, REGISTRY_STATE_LABELS, type HarnessFilter, type SourceFilter } from './model';

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
        <Field>
          <FieldLabel htmlFor="installed-harness">Harness</FieldLabel>
          <Select value={harnessFilter} onValueChange={(value) => setHarnessFilter(parseHarnessFilter(value))}>
            <SelectTrigger id="installed-harness" className="mt-2"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All harnesses</SelectItem><SelectItem value="claude-code">Claude Code</SelectItem><SelectItem value="opencode">OpenCode</SelectItem><SelectItem value="codex">Codex</SelectItem></SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="installed-source">Source</FieldLabel>
          <Select value={sourceFilter} onValueChange={(value) => setSourceFilter(parseSourceFilter(value))}>
            <SelectTrigger id="installed-source" className="mt-2"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All sources</SelectItem><SelectItem value="registry">From this registry</SelectItem><SelectItem value="local">Not from this registry</SelectItem></SelectContent>
          </Select>
        </Field>
        <Button variant="outline" size="sm" onClick={() => void queryClient.invalidateQueries({ queryKey: ['local-resources'] })} disabled={localLoading}><ArrowsClockwise size={16} className={cn(localLoading && 'animate-spin')} /> Refresh</Button>
      </div>
      <p className="pt-5 text-sm text-muted-foreground" role="status" aria-live="polite">{statusText}</p>
      {localRegistryError && <div className="pt-4"><ErrorMessage message={localRegistryError} /></div>}
      {localLoading ? <div className="space-y-3 py-6"><LoadingCard /></div> : <div className="space-y-3 py-6">{visibleResources.length === 0 ? <Empty><EmptyHeader><EmptyMedia><Info size={18} /></EmptyMedia><EmptyTitle>{localResources.length === 0 ? 'No local resources found' : 'No matching resources'}</EmptyTitle><EmptyDescription>{localResources.length === 0 ? 'Resources will appear here after the local harness scan.' : 'Try a different harness or source filter.'}</EmptyDescription></EmptyHeader></Empty> : visibleResources.map((resource) => { const key = resource.resource ? `${resource.resource}\u0000${resource.harness}` : ''; return <LocalResourceRow key={`${resource.harness}-${resource.path}`} resource={resource} homeDirectory={homeDirectory} staged={key ? staged[key] : undefined} onInstall={() => stageLocal(resource, 'install')} onUninstall={() => stageLocal(resource, 'uninstall')} onDiscard={() => key && unstage(key)} />; })}</div>}
    </SheetFrame>
  );
}

function LocalResourceRow({ resource, homeDirectory, staged, onInstall, onUninstall, onDiscard }: { resource: LocalResource; homeDirectory: string | undefined; staged: StagedItem | undefined; onInstall: () => void; onUninstall: () => void; onDiscard: () => void }) {
  const installLabel = resource.state === 'missing' || resource.state === 'modified' ? 'Reinstall' : 'Update';
  return <div className="rounded-xl border p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate font-medium">{resourceLabel(resource)}</p><Badge variant={resource.state === 'managed' ? 'success' : resource.state === 'unmanaged' ? 'muted' : 'warning'}>{LOCAL_STATE_LABELS[resource.state]}</Badge>{resource.resource && <Badge variant={resource.registryState === 'current' ? 'success' : resource.registryState === 'outdated' ? 'warning' : 'muted'}>{REGISTRY_STATE_LABELS[resource.registryState]}</Badge>}</div><p className="mt-1 text-xs text-muted-foreground">{resource.type} · {harnessLabel(resource.harness)}{resource.version ? ` · v${resource.version}` : ''}{resource.latestVersion && resource.latestVersion !== resource.version ? ` · latest v${resource.latestVersion}` : ''}</p></div>{resource.resource ? staged ? <div className="flex flex-wrap items-center gap-2"><Badge variant={staged.action === 'uninstall' ? 'destructive' : 'secondary'}>{staged.action === 'uninstall' ? 'Staged for uninstall' : 'Staged for install'}</Badge><Button variant="ghost" size="sm" onClick={onDiscard}>Discard</Button></div> : <div className="flex flex-wrap gap-2">{(resource.registryState === 'outdated' || resource.state === 'missing' || resource.state === 'modified') && <Button size="sm" onClick={onInstall}>{installLabel}</Button>}<Button variant="ghost" size="sm" onClick={onUninstall}>Uninstall</Button></div> : null}</div><p className="mt-3 truncate font-mono text-xs text-muted-foreground" title={resource.path}>{shortenHomePath(resource.path, homeDirectory)}</p>{resource.type === 'mcp-servers' && <p className="mt-2 text-xs text-muted-foreground">{resource.scope === 'project' ? 'Project scope' : 'User scope'}</p>}</div>;
}
