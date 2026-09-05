import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { resourceKey } from '@ai-directory/contracts';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Checkbox } from '../../components/ui/checkbox';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '../../components/ui/input-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { harnessLabel, scopeOptions, type Harness, type InstallScope, type RegistryResponse } from '../../lib/types';
import { api } from '../../lib/api';
import { ErrorMessage, LoadingCards, SheetFrame } from './common';
import { useDirectory } from './context';
import { DirectoryEmpty, HarnessToggleGroup, ScopeToggleGroup } from './shared';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon, Copy01Icon, Tick02Icon } from '@hugeicons/core-free-icons';

export function BatchSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const {
    selection,
    toggleSelected,
    setEntryHarnesses,
    clearSelection,
    scope,
    setScope,
    harnessDetection,
    installations,
  } = useDirectory();
  const queryClient = useQueryClient();
  const registry = useQuery<RegistryResponse>({ queryKey: ['registry'], queryFn: api.registry });
  const resources = registry.data?.index?.resources ?? [];
  const installedIds = new Set(installations.map((item) => item.resource));
  const pending = selection.flatMap((entry) => {
    const resource = resources.find((candidate) => resourceKey(candidate) === entry.id);
    return resource !== undefined && !installedIds.has(entry.id) ? [{ resource, harnesses: entry.harnesses }] : [];
  });
  const [copied, setCopied] = useState(false);
  const undetected = harnessDetection?.filter((item) => !item.detected).map((item) => item.harness);
  const scopeHint = scopeOptions.find((option) => option.value === scope)?.hint;
  const hasServer = pending.some(({ resource }) => resource.type === 'mcp-servers');
  const command = batchCommand(pending, hasServer ? scope : undefined);

  const mutation = useMutation({
    // Fail fast, sequential: stop at the first failure so the user sees
    // exactly which resource failed. Already-applied resources stay applied.
    mutationFn: async () => {
      const installed: string[] = [];
      for (const { resource, harnesses } of pending) {
        const id = resourceKey(resource);
        await api.install(resource.type === 'mcp-servers'
          ? { resource: id, harnesses, scope }
          : { resource: id, harnesses });
        installed.push(id);
      }
      return installed;
    },
    onSuccess: (installed) => {
      toast.success(installed.length === 1 ? `Installed ${installed[0]}.` : `Installed ${installed.length} resources.`);
      clearSelection();
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: ['installed'] });
      void queryClient.invalidateQueries({ queryKey: ['local-resources'] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Batch install failed.'),
  });

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

  const footer = (
    <div className="flex flex-col gap-2">
      <Button
        className="w-full"
        onClick={() => void mutation.mutateAsync()}
        disabled={pending.length === 0 || mutation.isPending}
      >
        {mutation.isPending ? 'Installing…' : pending.length === 0 ? 'Install' : `Install ${pending.length} resource${pending.length === 1 ? '' : 's'}`}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Applies directly to this machine.
      </p>
    </div>
  );

  return (
    <SheetFrame
      open={open}
      onOpenChange={onOpenChange}
      title="Batch install"
      description={pending.length === 0 ? 'Select resources from the catalog to install them together.' : `${pending.length} selected resource${pending.length === 1 ? '' : 's'} ready to install.`}
      footer={footer}
    >
      <div className="flex flex-col gap-5">
        {hasServer && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Scope</p>
            <ScopeToggleGroup value={scope} onValueChange={setScope} />
            <p className="text-muted-foreground">{scopeHint}</p>
          </div>
        )}
        {pending.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">CLI</p>
            <InputGroup>
              <InputGroupInput value={command} placeholder="aid install …" readOnly aria-label="Batch install command" />
              <InputGroupAddon align="inline-end">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <InputGroupButton size="icon-sm" aria-label="Copy batch install command" disabled={!command} onClick={() => void copy()} />
                    }
                  >
                    {copied ? <HugeiconsIcon icon={Tick02Icon} /> : <HugeiconsIcon icon={Copy01Icon} />}
                  </TooltipTrigger>
                  <TooltipContent>{copied ? 'Copied' : 'Copy batch install command'}</TooltipContent>
                </Tooltip>
              </InputGroupAddon>
            </InputGroup>
          </div>
        )}
        {registry.isPending ? (
          <LoadingCards count={2} />
        ) : registry.error ? (
          <ErrorMessage message={registry.error instanceof Error ? registry.error.message : 'Could not load the registry.'} />
        ) : pending.length > 0 ? (
          <Card className="gap-0 py-0">
            <ul className="divide-y px-4">
              {pending.map(({ resource, harnesses }) => {
                const id = resourceKey(resource);
                return (
                  <li key={id} className="flex flex-col gap-2 py-3">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked
                        onCheckedChange={() => toggleSelected(id)}
                        aria-label={`Remove ${id} from batch install`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{resource.name}</p>
                        <p className="truncate font-mono text-xs text-muted-foreground">{id}</p>
                      </div>
                      <p className="shrink-0 text-xs text-muted-foreground tabular-nums">v{resource.latestVersion}</p>
                    </div>
                    <HarnessToggleGroup
                      value={harnesses}
                      onValueChange={(next) => setEntryHarnesses(id, next)}
                      undetected={undetected}
                      ariaLabel={`Harnesses for ${id}`}
                    />
                    <p className="text-xs text-muted-foreground">
                      {harnesses.map(harnessLabel).join(', ')}
                    </p>
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : (
          <DirectoryEmpty
            icon={<HugeiconsIcon icon={Cancel01Icon} />}
            title="Nothing selected"
            description="Use the Add controls on catalog cards or resource pages to build a batch, then come back here."
          />
        )}
      </div>
    </SheetFrame>
  );
}

// One `aid install` command per distinct harness set, joined with `&&`.
// The web installs sequentially and fails fast, so the preview mirrors that:
// `aid install <skill> --harness codex && aid install <rule> --harness opencode`.
function batchCommand(
  pending: Array<{ resource: Parameters<typeof resourceKey>[0]; harnesses: Harness[] }>,
  scope: InstallScope | undefined,
): string {
  const groups = new Map<string, { resources: string[]; harnesses: string[]; hasServer: boolean }>();
  for (const { resource, harnesses } of pending) {
    const harnessList = [...harnesses].map(String).sort();
    const key = harnessList.join(',');
    const group = groups.get(key) ?? { resources: [], harnesses: harnessList, hasServer: false };
    group.resources.push(resourceKey(resource));
    if (resource.type === 'mcp-servers') group.hasServer = true;
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) =>
      `aid install ${group.resources.join(' ')}${group.harnesses.map((item) => ` --harness ${item}`).join('')}${group.hasServer && scope ? ` --scope ${scope}` : ''}`,
    )
    .join(' && ');
}
