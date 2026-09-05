import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { resourceKey, type ResourceSummary } from '@ai-directory/contracts';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { harnessLabel, type Harness } from '../../lib/types';
import { api } from '../../lib/api';
import { useDirectory } from './context';
import { HarnessToggleGroup } from './shared';
import { Badge } from '../../components/ui/badge';
import { badgeTone } from './shared';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon, PlayListAddIcon } from '@hugeicons/core-free-icons';

export function InstallPanel({ resource }: { resource: ResourceSummary }) {
  const { installations, localResources, selection, toggleSelected, setEntryHarnesses, setSheet, harnessDetection } = useDirectory();
  const queryClient = useQueryClient();
  const id = resourceKey(resource);
  // Any-harness rule: one install anywhere flips the panel to Installed.
  // Partial coverage (installed for some harnesses only) shows as a hint.
  const records = installations.filter((item) => item.resource === id);
  const installed = records.length > 0;
  const entry = selection.find((item) => item.id === id);
  const selected = entry !== undefined;
  const undetected = harnessDetection?.filter((item) => !item.detected).map((item) => item.harness);
  const localRows = localResources.filter((item) => item.resource === id);

  const uninstallMutation = useMutation({
    mutationFn: () => {
      const harnessList = [...new Set(records.map((item) => item.harness))];
      const scopes = [...new Set(records.map((item) => item.scope ?? 'user'))];
      const scopeParam = resource.type === 'mcp-servers' ? scopes[0] ?? 'user' : undefined;
      return api.uninstall(id, harnessList, scopeParam);
    },
    onSuccess: () => {
      toast.success(`Uninstalled ${id}.`);
      void queryClient.invalidateQueries({ queryKey: ['installed'] });
      void queryClient.invalidateQueries({ queryKey: ['local-resources'] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Uninstall failed.'),
  });

  return (
    <Card className="lg:sticky lg:top-20">
      <CardHeader>
        <CardTitle>{installed ? 'Installed' : 'Install'}</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={installed ? 'installed' : 'install'}>
          <TabsList aria-label="Install state">
            <TabsTrigger value="install" disabled={installed}>Install</TabsTrigger>
            <TabsTrigger value="installed" disabled={!installed}>Installed here</TabsTrigger>
          </TabsList>
          <TabsContent value="install" className="flex flex-col gap-4 pt-4">
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Harnesses for this resource</p>
              {selected && entry ? (
                <>
                  <HarnessToggleGroup
                    value={entry.harnesses}
                    onValueChange={(next) => setEntryHarnesses(id, next)}
                    undetected={undetected}
                    ariaLabel={`Harnesses for ${id}`}
                  />
                  <p className="text-xs text-muted-foreground">
                    {entry.harnesses.map(harnessLabel).join(', ')}
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Add it to the batch first, then pick harnesses here or in the Batch drawer.
                </p>
              )}
            </div>
            <Button
              className="w-full"
              variant={selected ? 'secondary' : 'default'}
              onClick={() => toggleSelected(id)}
              aria-pressed={selected}
              aria-label={selected ? `Remove ${id} from batch install` : `Add ${id} to batch install`}
            >
              <HugeiconsIcon icon={selected ? Cancel01Icon : PlayListAddIcon} data-icon="inline-start" />
              {selected ? 'Remove from batch' : 'Add to batch'}
            </Button>
            {selected && (
              <Button className="w-full" variant="outline" onClick={() => setSheet('batch')}>
                Review batch
              </Button>
            )}
            <p className="text-center text-xs text-muted-foreground">
              Installs together with the batch from the Batch drawer.
            </p>
          </TabsContent>
          <TabsContent value="installed" className="flex flex-col gap-3 pt-4">
            {installed ? (
              <InstalledRows id={id} localRows={localRows} />
            ) : (
              <p className="text-xs text-muted-foreground">Not installed on this machine yet.</p>
            )}
            {installed && <CoverageHint id={id} entryHarnesses={entry?.harnesses} />}
            {installed && (
              <Button className="w-full" variant="outline" onClick={() => void uninstallMutation.mutateAsync()} disabled={uninstallMutation.isPending}>
                {uninstallMutation.isPending ? 'Working…' : 'Uninstall everywhere'}
              </Button>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function InstalledRows({ id, localRows }: {
  id: string;
  localRows: ReturnType<typeof useDirectory>['localResources'];
}) {
  const queryClient = useQueryClient();

  const reinstallMutation = useMutation({
    mutationFn: (row: (typeof localRows)[number]) => api.install(
      row.type === 'mcp-servers'
        ? { resource: id, harnesses: [row.harness], scope: row.scope ?? 'user' }
        : { resource: id, harnesses: [row.harness] },
    ),
    onSuccess: () => {
      toast.success(`Reinstalled ${id}.`);
      void queryClient.invalidateQueries({ queryKey: ['installed'] });
      void queryClient.invalidateQueries({ queryKey: ['local-resources'] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Reinstall failed.'),
  });

  if (localRows.length === 0) {
    return <p className="text-xs text-muted-foreground">Installed, but no local files were found on the last scan.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {localRows.map((row) => (
        <li key={`${row.harness}-${row.path}`} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{harnessLabel(row.harness)}</p>
            <p className="truncate font-mono text-xs text-muted-foreground tabular-nums">
              {row.version ? `v${row.version}` : 'unknown version'}
              {row.latestVersion && row.latestVersion !== row.version ? ` → v${row.latestVersion}` : ''}
              {' · '}{row.state}
            </p>
          </div>
          {(row.registryState === 'outdated' || row.state === 'missing' || row.state === 'modified') && (
            <Button
              size="sm"
              variant="outline"
              disabled={reinstallMutation.isPending}
              onClick={() => void reinstallMutation.mutateAsync(row)}
            >
              {reinstallMutation.isPending ? 'Working…' : row.state === 'missing' || row.state === 'modified' ? 'Reinstall' : 'Update'}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

// Partial coverage is a hint, not a state: the resource is installed, but
// the current batch entry targets harnesses that have no installation yet.
function CoverageHint({ id, entryHarnesses }: { id: string; entryHarnesses: Harness[] | undefined }) {
  const { installations } = useDirectory();
  const installedHarnesses = [...new Set(
    installations.filter((item) => item.resource === id).map((item) => item.harness),
  )];
  const missing = (entryHarnesses ?? []).filter((harness) => !installedHarnesses.includes(harness));
  if (missing.length === 0) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Installed for {installedHarnesses.map(harnessLabel).join(', ')}. Also staged for{' '}
      {missing.map(harnessLabel).join(', ')} — run the batch to cover{' '}
      {missing.length === 1 ? 'it' : 'them'}.
      {' '}<Badge {...badgeTone('warning')}>Partial</Badge>
    </p>
  );
}
