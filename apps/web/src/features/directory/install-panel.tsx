import { useState } from 'react';
import { toast } from 'sonner';
import { ArrowUpRight } from '@phosphor-icons/react/dist/csr/ArrowUpRight';
import { Check } from '@phosphor-icons/react/dist/csr/Check';
import { Copy } from '@phosphor-icons/react/dist/csr/Copy';
import { resourceKey, type ResourceSummary } from '@ai-directory/contracts';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Checkbox } from '../../components/ui/checkbox';
import { FieldGroup, FieldLegend } from '../../components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupInput } from '../../components/ui/input-group';
import { Label } from '../../components/ui/label';
import { RadioGroup, RadioGroupItem } from '../../components/ui/radio-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { harnessOptions, scopeOptions, type Harness, type InstallScope, type StagedItem } from '../../lib/types';
import { cn } from '../../lib/utils';
import { installScope } from './model';
import { useDirectory } from './context';

export function InstallPanel({ resource, staged }: { resource: ResourceSummary; staged: StagedItem | undefined }) {
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
    <section aria-labelledby="install-title">
      <h2 id="install-title" className="text-xl font-semibold tracking-tight">Install this resource</h2>
      <p className="mt-2 text-sm text-muted-foreground">Choose the target harnesses, then review the change plan before applying it.</p>
      <Card className="mt-5">
        <CardContent className="space-y-6 p-5 sm:p-6">
          <FieldGroup>
            <FieldLegend>Install in</FieldLegend>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {harnessOptions.map((option) => (
                <Label className={cn('flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-3 text-sm transition-colors', selectedHarnesses.includes(option.value) ? 'border-primary/50 bg-primary/5' : 'border-border')} htmlFor={`install-harness-${option.value}`} key={option.value}>
                  <Checkbox id={`install-harness-${option.value}`} checked={selectedHarnesses.includes(option.value)} onCheckedChange={(checked) => toggleHarness(option.value, checked === true)} />
                  <span>{option.label}</span>
                </Label>
              ))}
            </div>
          </FieldGroup>
          {resource.type === 'mcp-servers' && (
            <FieldGroup className="border-t pt-5">
              <FieldLegend>Scope</FieldLegend>
              <RadioGroup className="mt-3 grid gap-2 sm:grid-cols-2" value={selectedScope} onValueChange={(value) => { const next = installScope(value); setSelectedScope(next); setScope(next); }}>
                {scopeOptions.map((option) => (
                  <Label className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 text-sm" htmlFor={`resource-scope-${option.value}`} key={option.value}>
                    <RadioGroupItem className="mt-0.5" id={`resource-scope-${option.value}`} value={option.value} />
                    <span><span className="block font-medium">{option.label}</span><span className="mt-1 block text-xs text-muted-foreground">{option.hint}</span></span>
                  </Label>
                ))}
              </RadioGroup>
            </FieldGroup>
          )}
          <div className="border-t pt-5">
            <InputGroup className="bg-muted">
              <InputGroupInput value={command || 'Select at least one harness.'} readOnly aria-label="Install command" />
              <InputGroupAddon align="inline-end">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="Copy install command" onClick={() => void copy()}>{copied ? <Check size={17} /> : <Copy size={17} />}</Button>
                  </TooltipTrigger>
                  <TooltipContent>{copied ? 'Copied' : 'Copy install command'}</TooltipContent>
                </Tooltip>
              </InputGroupAddon>
            </InputGroup>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">{selectedHarnesses.length === 0 ? 'Select at least one harness.' : staged ? 'Saved in Changes.' : `${selectedHarnesses.length} harness${selectedHarnesses.length === 1 ? '' : 'es'} selected.`}</span>
              <div className="flex gap-2">
                {staged && <Button variant="ghost" onClick={() => unstage(id)}>Remove</Button>}
                <Button onClick={save} disabled={selectedHarnesses.length === 0}>{staged ? 'Update Changes' : 'Add to Changes'} <ArrowUpRight size={16} /></Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
