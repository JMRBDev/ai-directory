import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../../components/ui/accordion';
import { Info } from '@phosphor-icons/react/dist/csr/Info';
import { Trash } from '@phosphor-icons/react/dist/csr/Trash';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Field, FieldLabel } from '../../components/ui/field';
import { Label } from '../../components/ui/label';
import { RadioGroup, RadioGroupItem } from '../../components/ui/radio-group';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { harnessLabel, harnessOptions, scopeOptions, type ChangePlan, type StagedItem } from '../../lib/types';
import { cn } from '../../lib/utils';
import { ErrorMessage, LoadingCard, SheetFrame } from './common';
import { useDirectory } from './context';
import { hasApplyableOperation, installScope } from './model';

export function ChangesSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const {
    staged,
    plan,
    planLoading,
    planError,
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
            {items.map((item) => <ChangeItem item={item} key={item.key} onRemove={() => unstage(item.key)} onUpdate={updateStage} disabled={busy} />)}
            <div className="flex justify-end"><Button variant="ghost" size="sm" onClick={clear}>Discard all</Button></div>
            {items.some((item) => item.type === 'mcp-servers') && (
              <Field className="border-t pt-5">
                <FieldLabel>Default MCP scope</FieldLabel>
                <RadioGroup className="mt-3 grid gap-2 sm:grid-cols-2" value={scope} onValueChange={(value) => setScope(installScope(value))}>
                  {scopeOptions.map((option) => (
                    <Label className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 text-sm" htmlFor={`changes-scope-${option.value}`} key={option.value}>
                      <RadioGroupItem className="mt-0.5" id={`changes-scope-${option.value}`} value={option.value} />
                      <span><span className="block font-medium">{option.label}</span><span className="mt-1 block text-xs text-muted-foreground">{option.hint}</span></span>
                    </Label>
                  ))}
                </RadioGroup>
              </Field>
            )}
            {planLoading && <LoadingCard />}
            {planError && <ErrorMessage message={planError} />}
            {plan && <PlanSummary plan={plan.plan} />}
            {plan?.plan.conflicts.length ? <Label className="flex items-center gap-2 text-sm" htmlFor="changes-force"><Checkbox id="changes-force" checked={force} onCheckedChange={(checked) => setForce(checked === true)} /> Apply despite conflicts</Label> : null}
            {plan?.plan.dependencyRemovals.length ? <Label className="flex items-center gap-2 text-sm" htmlFor="changes-remove-dependencies"><Checkbox id="changes-remove-dependencies" checked={removeDependencies} onCheckedChange={(checked) => setRemoveDependencies(checked === true)} /> Remove unused dependencies</Label> : null}
            <Button className="w-full" onClick={applyChanges} disabled={!canApply}>{busy ? 'Applying…' : plan && plan.plan.changes.length > 0 ? `Apply ${plan.plan.changes.length} file changes` : `Apply ${operationCount} operation${operationCount === 1 ? '' : 's'}`}</Button>
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
        <div><p className="font-medium">{item.resource}</p><Badge className="mt-2" variant={item.action === 'install' ? 'success' : 'destructive'}>{item.action === 'install' ? 'Install' : 'Uninstall'}</Badge></div>
        <Tooltip>
          <TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label={`Remove ${item.resource}`} onClick={onRemove}><Trash size={17} /></Button></TooltipTrigger>
          <TooltipContent>Remove {item.resource}</TooltipContent>
        </Tooltip>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {harnessOptions.map((option) => (
          <Label className="flex items-center gap-2 text-xs text-muted-foreground" htmlFor={`change-${item.key}-${option.value}`} key={option.value}>
            <Checkbox id={`change-${item.key}-${option.value}`} checked={selected.includes(option.value)} disabled={disabled} onCheckedChange={(checked) => onUpdate({ ...item, harnesses: checked === true ? [...selected, option.value] : selected.filter((candidate) => candidate !== option.value) })} />
            {harnessLabel(option.value)}
          </Label>
        ))}
      </div>
      {item.type === 'mcp-servers' && <Select value={item.scope ?? scope} onValueChange={(value) => onUpdate({ ...item, scope: installScope(value) })} disabled={disabled}><SelectTrigger className="mt-3"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="user">User scope</SelectItem><SelectItem value="project">Project scope</SelectItem></SelectContent></Select>}
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
      <ScrollArea className="h-80 border-t pt-3">
        <Accordion type="multiple">
          {plan.changes.map((change) => (
            <AccordionItem className="rounded-lg border bg-background/60 px-2" key={`${change.path}-${change.harness}-${change.action}`} value={`${change.path}-${change.harness}-${change.action}`}>
              <AccordionTrigger className="gap-2 py-2 text-xs hover:no-underline"><span className={cn('size-1.5 shrink-0 rounded-full', change.action === 'removed' ? 'bg-destructive' : change.action === 'added' ? 'bg-emerald-500' : 'bg-amber-500')} /><span className="min-w-0 flex-1 truncate"><code className="font-mono">{change.path}</code><span className="ml-2 text-muted-foreground">{change.resource} · {harnessLabel(change.harness)}</span></span><span className="shrink-0 text-muted-foreground">{change.action}</span></AccordionTrigger>
              {(change.before || change.after) && <AccordionContent className="border-t pt-2"><ScrollArea className="h-64"><pre className="text-[11px] leading-5"><code>{change.action === 'modified' ? `Before:\n${change.before ?? '(file did not exist)'}\n\nAfter:\n${change.after ?? '(file will be removed)'}` : change.after ?? change.before}</code></pre></ScrollArea></AccordionContent>}
            </AccordionItem>
          ))}
        </Accordion>
      </ScrollArea>
    </div>
  );
}
