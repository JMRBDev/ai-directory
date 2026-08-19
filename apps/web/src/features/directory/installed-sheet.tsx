import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowsClockwise } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { Info } from '@phosphor-icons/react/dist/csr/Info';
import { Button } from '../../components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../../components/ui/empty';
import { Field, FieldLabel } from '../../components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { cn } from '../../lib/utils';
import type { Action, LocalResource, StagedItem } from '../../lib/types';
import { ErrorMessage, LoadingCard, SheetFrame } from './common';
import { useDirectory } from './context';
import { parseHarnessFilter, parseSourceFilter, type HarnessFilter, type SourceFilter } from './model';
import { LocalResourceRow } from './local-resource-row';

export function InstalledSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { localResources, localError, localLoading, localRegistryError, homeDirectory, staged, harnesses, stage, unstage } = useDirectory();
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
      {localError && <div className="pt-4"><ErrorMessage message={localError} /></div>}
      {localRegistryError && <div className="pt-4"><ErrorMessage message={localRegistryError} /></div>}
      {localLoading ? <div className="space-y-3 py-6"><LoadingCard /></div> : localError ? null : <div className="space-y-3 py-6">{visibleResources.length === 0 ? <Empty><EmptyHeader><EmptyMedia><Info size={18} /></EmptyMedia><EmptyTitle>{localResources.length === 0 ? 'No local resources found' : 'No matching resources'}</EmptyTitle><EmptyDescription>{localResources.length === 0 ? 'Resources will appear here after the local harness scan.' : 'Try a different harness or source filter.'}</EmptyDescription></EmptyHeader></Empty> : visibleResources.map((resource) => { const key = resource.resource ? `${resource.resource}\u0000${resource.harness}` : ''; return <LocalResourceRow key={`${resource.harness}-${resource.path}`} resource={resource} homeDirectory={homeDirectory} staged={key ? staged[key] : undefined} onInstall={() => stageLocal(resource, 'install')} onUninstall={() => stageLocal(resource, 'uninstall')} onDiscard={() => key && unstage(key)} />; })}</div>}
    </SheetFrame>
  );
}
