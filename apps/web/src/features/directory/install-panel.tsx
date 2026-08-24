import { useState } from 'react';
import { toast } from 'sonner';
import { resourceKey, type ResourceSummary } from '@ai-directory/contracts';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../../components/ui/card';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '../../components/ui/input-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { harnessOptions, scopeOptions, type Harness, type InstallScope, type StagedItem } from '../../lib/types';
import { useDirectory } from './context';
import { HarnessToggleGroup, ScopeToggleGroup } from './shared';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowUpRight01Icon, Copy01Icon, Tick02Icon } from '@hugeicons/core-free-icons';

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
    <Card className="lg:sticky lg:top-20">
      <CardHeader>
        <CardTitle>Install</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Install in</p>
          <HarnessToggleGroup value={selectedHarnesses} onValueChange={setSelectedHarnesses} />
        </div>
        {isServer && (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Scope</p>
            <ScopeToggleGroup
              value={selectedScope}
              onValueChange={(scoped) => { setSelectedScope(scoped); setScope(scoped); }}
            />
            <p className="text-muted-foreground">{scopeHint}</p>
          </div>
        )}
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">CLI</p>
          <InputGroup className="font-mono">
            <InputGroupInput value={command} placeholder="aid install …" readOnly aria-label="Install command" />
            <InputGroupAddon align="inline-end">
              <Tooltip>
                <TooltipTrigger asChild>
                  <InputGroupButton size="icon-sm" aria-label="Copy install command" disabled={!command} onClick={() => void copy()}>
                    {copied ? <HugeiconsIcon icon={Tick02Icon} /> : <HugeiconsIcon icon={Copy01Icon} />}
                  </InputGroupButton>
                </TooltipTrigger>
                <TooltipContent>{copied ? 'Copied' : 'Copy install command'}</TooltipContent>
              </Tooltip>
            </InputGroupAddon>
          </InputGroup>
        </div>
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-2 border-t">
        <Button className="w-full" onClick={save} disabled={selectedHarnesses.length === 0}>
          {stagedItem ? 'Update changes' : 'Add to changes'} <HugeiconsIcon icon={ArrowUpRight01Icon} data-icon="inline-end" size={15} />
        </Button>
        {stagedItem && (
          <Button className="w-full" variant="ghost" size="sm" onClick={() => unstage(id)}>Remove from changes</Button>
        )}
        <p className="text-center text-muted-foreground">
          {selectedHarnesses.length === 0 ? 'Select at least one harness.' : stagedItem ? 'Saved in Changes.' : 'Reviewed together in Changes before applying.'}
        </p>
      </CardFooter>
    </Card>
  );
}
