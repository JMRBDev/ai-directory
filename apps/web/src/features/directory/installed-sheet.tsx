import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { cn } from '../../lib/utils';
import type { Action, LocalResource, StagedItem } from '../../lib/types';
import { ErrorMessage, LoadingCards, SheetFrame } from './common';
import { useDirectory } from './context';
import { parseHarnessFilter, parseSourceFilter, type HarnessFilter, type SourceFilter } from './model';
import { LocalResourceRow } from './local-resource-row';
import { DirectoryEmpty } from './shared';
import { HugeiconsIcon } from '@hugeicons/react';
import { InfoIcon, RefreshIcon } from '@hugeicons/core-free-icons';

const harnessOptions = [
  { value: 'all', label: 'All harnesses' },
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'opencode', label: 'OpenCode' },
  { value: 'codex', label: 'Codex' },
] as const;

const sourceOptions = [
  { value: 'all', label: 'All sources' },
  { value: 'registry', label: 'From this registry' },
  { value: 'local', label: 'Not from this registry' },
] as const;

function selectedLabel<T extends string>(options: ReadonlyArray<{ value: T; label: string }>, value: T): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

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

  return (
    <SheetFrame open={open} onOpenChange={onOpenChange} title="Installed resources" description="Resources found in your local harness directories.">
      <div className="flex items-center gap-2">
        <Select value={harnessFilter} onValueChange={(value) => { if (value !== null) setHarnessFilter(parseHarnessFilter(value)); }}>
          <SelectTrigger aria-label="Harness" className="flex-1"><SelectValue>{selectedLabel(harnessOptions, harnessFilter)}</SelectValue></SelectTrigger>
          <SelectContent>{harnessOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={(value) => { if (value !== null) setSourceFilter(parseSourceFilter(value)); }}>
          <SelectTrigger aria-label="Source" className="flex-1"><SelectValue>{selectedLabel(sourceOptions, sourceFilter)}</SelectValue></SelectTrigger>
          <SelectContent>{sourceOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          aria-label="Refresh local scan"
          onClick={() => void queryClient.invalidateQueries({ queryKey: ['local-resources'] })}
          disabled={localLoading}
        >
          <HugeiconsIcon icon={RefreshIcon} className={cn(localLoading && 'animate-spin')} />
        </Button>
      </div>
      {localError && <ErrorMessage message={localError} />}
      {localRegistryError && <ErrorMessage message={localRegistryError} />}
      {localLoading ? (
        <LoadingCards count={2} />
      ) : !localError && visibleResources.length > 0 ? (
        <>
          <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
            {visibleResources.length} resource{visibleResources.length === 1 ? '' : 's'}
          </p>
          <Card className="gap-0 py-0">
            <ul className="divide-y px-4">
              {visibleResources.map((resource) => {
                const key = resource.resource ? `${resource.resource}\u0000${resource.harness}` : '';
                return (
                  <LocalResourceRow
                    key={`${resource.harness}-${resource.path}`}
                    resource={resource}
                    homeDirectory={homeDirectory}
                    staged={key ? staged[key] : undefined}
                    onInstall={() => stageLocal(resource, 'install')}
                    onUninstall={() => stageLocal(resource, 'uninstall')}
                    onDiscard={() => key && unstage(key)}
                  />
                );
              })}
            </ul>
          </Card>
        </>
      ) : (
        <DirectoryEmpty
          icon={<HugeiconsIcon icon={InfoIcon} />}
          title={localResources.length === 0 ? 'No local resources found' : 'No matching resources'}
          description={localResources.length === 0 ? 'Resources will appear here after the local harness scan.' : 'Try a different harness or source filter.'}
        />
      )}
    </SheetFrame>
  );
}
