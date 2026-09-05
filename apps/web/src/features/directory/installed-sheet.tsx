import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { cn } from '../../lib/utils';
import { api, type InstallRequest } from '../../lib/api';
import type { LocalResource } from '../../lib/types';
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
  const { localResources, localError, localLoading, localRegistryError } = useDirectory();
  const queryClient = useQueryClient();
  const [harnessFilter, setHarnessFilter] = useState<HarnessFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const visibleResources = localResources.filter((resource) => {
    const matchesHarness = harnessFilter === 'all' || resource.harness === harnessFilter;
    const matchesSource = sourceFilter === 'all' || (sourceFilter === 'registry' ? resource.resource !== undefined : resource.resource === undefined);
    return matchesHarness && matchesSource;
  });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['installed'] });
    void queryClient.invalidateQueries({ queryKey: ['local-resources'] });
  }

  async function act(key: string, resource: LocalResource, action: 'install' | 'uninstall') {
    if (!resource.resource || busyKey) return;
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

  return (
    <SheetFrame open={open} onOpenChange={onOpenChange} title="Installed resources" description="Resources found in your local harness directories.">
      <div className="flex flex-col gap-5">
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
                  const key = `${resource.harness}-${resource.path}`;
                  return (
                    <LocalResourceRow
                      key={key}
                      resource={resource}
                      busy={busyKey === key}
                      onInstall={() => void act(key, resource, 'install')}
                      onUninstall={() => void act(key, resource, 'uninstall')}
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
      </div>
    </SheetFrame>
  );
}
