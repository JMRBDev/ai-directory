import { useState } from 'react';
import { toast } from 'sonner';
import { ArrowUpRight } from '@phosphor-icons/react/dist/csr/ArrowUpRight';
import { Check } from '@phosphor-icons/react/dist/csr/Check';
import { Copy } from '@phosphor-icons/react/dist/csr/Copy';
import { resourceKey, type ResourceSummary } from '@ai-directory/contracts';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { InputGroup, InputGroupAddon, InputGroupInput } from '../../components/ui/input-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { ToggleGroup, ToggleGroupItem } from '../../components/ui/toggle-group';
import { harnessOptions, scopeOptions, type Harness, type InstallScope, type StagedItem } from '../../lib/types';
import { installScope } from './model';
import { useDirectory } from './context';

function harnessesFrom(value: string[]): Harness[] {
  return harnessOptions.map((option) => option.value).filter((item) => value.includes(item));
}

export function InstallPanel({ resource }: { resource: ResourceSummary }) {
  const { staged, harnesses, scope, setScope, stage, unstage } = useDirectory();
  const id = resourceKey(resource);
  const stagedItem = staged[id];
  const [selectedHarnesses, setSelectedHarnesses] = useState<Harness[]>(stagedItem?.harnesses ?? harnesses);
  const [selectedScope, setSelectedScope] = useState<InstallScope>(stagedItem?.scope ?? scope);
  const [copied, setCopied] = useState(false);
  const isServer = resource.type === 'mcp-servers';
  const command = selectedHarnesses.length === 0
    ? ''
    : `aid install ${id} ${selectedHarnesses.map((item) => `--harness ${item}`).join(' ')}${isServer ? ` --scope ${selectedScope}` : ''}`;
  const scopeHint = scopeOptions.find((option) => option.value === selectedScope)?.hint;

  function save() {
    if (selectedHarnesses.length === 0) return;
    const item: StagedItem = { key: id, resource: id, type: resource.type, action: 'install', harnesses: selectedHarnesses };
    if (isServer) item.scope = selectedScope;
    stage(item);
  }

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

  return (
    <Card className="flex flex-col gap-5 p-5 lg:sticky lg:top-20">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Install in</p>
        <ToggleGroup
          type="multiple"
          segmented
          value={selectedHarnesses}
          onValueChange={(value) => setSelectedHarnesses(harnessesFrom(value))}
          aria-label="Target harnesses"
        >
          {harnessOptions.map((option) => (
            <ToggleGroupItem value={option.value} key={option.value}>{option.label}</ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {isServer && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Scope</p>
          <ToggleGroup
            type="single"
            segmented
            value={selectedScope}
            onValueChange={(value) => { if (value) { const next = installScope(value); setSelectedScope(next); setScope(next); } }}
            aria-label="Installation scope"
          >
            {scopeOptions.map((option) => (
              <ToggleGroupItem value={option.value} key={option.value}>{option.label}</ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-xs text-muted-foreground">{scopeHint}</p>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">CLI</p>
        <InputGroup>
          <InputGroupInput className="font-mono text-xs" value={command} placeholder="aid install …" readOnly aria-label="Install command" />
          <InputGroupAddon align="inline-end">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Copy install command" disabled={!command} onClick={() => void copy()}>{copied ? <Check size={16} /> : <Copy size={16} />}</Button>
              </TooltipTrigger>
              <TooltipContent>{copied ? 'Copied' : 'Copy install command'}</TooltipContent>
            </Tooltip>
          </InputGroupAddon>
        </InputGroup>
      </div>
      <div className="mt-auto space-y-2">
        <Button className="w-full" onClick={save} disabled={selectedHarnesses.length === 0}>
          {stagedItem ? 'Update changes' : 'Add to changes'} <ArrowUpRight data-icon="inline-end" size={15} />
        </Button>
        {stagedItem && (
          <Button className="w-full" variant="ghost" size="sm" onClick={() => unstage(id)}>Remove from changes</Button>
        )}
        <p className="text-center text-xs text-muted-foreground">
          {selectedHarnesses.length === 0 ? 'Select at least one harness.' : stagedItem ? 'Saved in Changes.' : 'Reviewed together in Changes before applying.'}
        </p>
      </div>
    </Card>
  );
}
