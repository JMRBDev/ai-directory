import { ArrowsClockwise } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { Info } from '@phosphor-icons/react/dist/csr/Info';
import { Trash } from '@phosphor-icons/react/dist/csr/Trash';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../../components/ui/accordion';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Checkbox } from '../../components/ui/checkbox';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../../components/ui/empty';
import { Label } from '../../components/ui/label';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { ToggleGroup, ToggleGroupItem } from '../../components/ui/toggle-group';
import { harnessLabel, harnessOptions, shortenHomePath, type ChangePlan, type StagedItem } from '../../lib/types';
import { ErrorMessage, SheetFrame } from './common';
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
  } = useDirectory();
  const items = Object.values(staged);
  const canApply = Boolean(plan && hasApplyableOperation(plan.plan) && (plan.plan.conflicts.length === 0 || force) && !busy);
  const operationCount = plan?.plan.operations.length ?? 0;

  return (
    <SheetFrame open={open} onOpenChange={onOpenChange} title="Changes" description="Review the staged operations before they touch your local harness files.">
      {items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><Info /></EmptyMedia>
            <EmptyTitle>Nothing staged</EmptyTitle>
            <EmptyDescription>Select resources from the catalog or an installed resource.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <Card className="gap-0 py-0">
            <ul className="divide-y">
              {items.map((item) => (
                <ChangeItem item={item} key={item.key} onRemove={() => unstage(item.key)} onUpdate={updateStage} disabled={busy} />
              ))}
            </ul>
          </Card>
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={clear} disabled={busy}>Discard all</Button>
          </div>
          {planLoading && <p className="text-sm text-muted-foreground">Planning…</p>}
          {planError && <ErrorMessage message={planError} />}
          {plan && <PlanSummary plan={plan.plan} />}
          {plan?.plan.conflicts.length ? (
            <Label className="text-sm" htmlFor="changes-force">
              <Checkbox id="changes-force" checked={force} onCheckedChange={(checked) => setForce(checked === true)} /> Apply despite conflicts
            </Label>
          ) : null}
          {plan?.plan.dependencyRemovals.length ? (
            <Label className="text-sm" htmlFor="changes-remove-dependencies">
              <Checkbox id="changes-remove-dependencies" checked={removeDependencies} onCheckedChange={(checked) => setRemoveDependencies(checked === true)} /> Remove unused dependencies
            </Label>
          ) : null}
          <Button className="w-full" onClick={applyChanges} disabled={!canApply}>
            {busy && <ArrowsClockwise size={15} className="animate-spin" />}
            {busy ? 'Applying…' : plan && plan.plan.changes.length > 0 ? `Apply ${plan.plan.changes.length} file change${plan.plan.changes.length === 1 ? '' : 's'}` : `Apply ${operationCount} operation${operationCount === 1 ? '' : 's'}`}
          </Button>
        </>
      )}
    </SheetFrame>
  );
}

function itemName(resource: string) {
  return resource.split('/')[2] ?? resource;
}

function ChangeItem({ item, onRemove, onUpdate, disabled }: { item: StagedItem; onRemove: () => void; onUpdate: (item: StagedItem) => void; disabled: boolean }) {
  const { harnesses, scope } = useDirectory();
  const selected = item.harnesses.length > 0 ? item.harnesses : harnesses;

  return (
    <li className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{itemName(item.resource)}</p>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{item.resource.split('/').slice(0, 2).join('/')}</p>
        </div>
        <Badge variant={item.action === 'install' ? 'success' : 'destructive'} className="shrink-0">
          {item.action === 'install' ? 'Install' : 'Remove'}
        </Badge>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove ${itemName(item.resource)}`}
              onClick={onRemove}
            >
              <Trash size={15} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Remove</TooltipContent>
        </Tooltip>
      </div>
      <ToggleGroup
        multiple
        value={selected}
        onValueChange={(value) => onUpdate({ ...item, harnesses: harnessOptions.map((option) => option.value).filter((candidate) => value.includes(candidate)) })}
        disabled={disabled}
        aria-label={`Harnesses for ${itemName(item.resource)}`}
      >
        {harnessOptions.map((option) => (
          <ToggleGroupItem value={option.value} key={option.value}>{harnessLabel(option.value)}</ToggleGroupItem>
        ))}
      </ToggleGroup>
      {item.type === 'mcp-servers' && (
        <ToggleGroup
          value={[item.scope ?? scope]}
          onValueChange={(value) => { const next = value[0]; if (next) onUpdate({ ...item, scope: installScope(next) }); }}
          disabled={disabled}
          aria-label={`Scope for ${itemName(item.resource)}`}
        >
          <ToggleGroupItem value="user">User scope</ToggleGroupItem>
          <ToggleGroupItem value="project">Project scope</ToggleGroupItem>
        </ToggleGroup>
      )}
    </li>
  );
}

function PlanSummary({ plan }: { plan: ChangePlan }) {
  const { homeDirectory } = useDirectory();
  const changedResources = new Set(plan.changes.map((change) => change.resource));
  const recordOnlyOperations = plan.operations.filter((operation) => !changedResources.has(operation.resource));

  return (
    <section aria-labelledby="changes-plan-title" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 id="changes-plan-title" className="text-sm font-medium">Preview</h3>
        <Badge variant={plan.conflicts.length > 0 ? 'warning' : 'secondary'}>{plan.changes.length > 0 ? `${plan.changes.length} file change${plan.changes.length === 1 ? '' : 's'}` : `${plan.operations.length} operations`}</Badge>
      </div>
      {plan.conflicts.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>{plan.conflicts.join(' ')}</AlertDescription>
        </Alert>
      )}
      {plan.warnings.length > 0 && (
        <Alert>
          <AlertDescription>{plan.warnings.join(' ')}</AlertDescription>
        </Alert>
      )}
      {recordOnlyOperations.length > 0 && (
        <Alert>
          {recordOnlyOperations.map((operation) => (
            <AlertDescription key={`${operation.resource}-${operation.action}`}>
              <code className="font-mono">{operation.resource}</code> will be {operation.action === 'uninstall' ? 'removed' : 'updated'} without file changes.
            </AlertDescription>
          ))}
        </Alert>
      )}
      {plan.changes.length > 0 && (
        <ScrollArea className="max-h-80 rounded-lg border" tabIndex={0}>
          <Accordion multiple className="rounded-none border-none">
            {plan.changes.map((change) => (
              <AccordionItem className="px-3" key={`${change.path}-${change.harness}-${change.action}`} value={`${change.path}-${change.harness}-${change.action}`}>
                <AccordionTrigger className="gap-2 py-2.5 text-xs hover:no-underline">
                  <span className="min-w-0 flex-1 truncate text-left"><code className="font-mono">{shortenHomePath(change.path, homeDirectory)}</code></span>
                  <span className="shrink-0 text-muted-foreground">{harnessLabel(change.harness)} · {change.action}</span>
                </AccordionTrigger>
                {(change.before || change.after) && (
                  <AccordionContent className="pb-3 pt-1">
                    <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/60 p-3 font-mono text-xs leading-5"><code>{change.action === 'modified' ? `Before:\n${change.before ?? '(file did not exist)'}\n\nAfter:\n${change.after ?? '(file will be removed)'}` : change.after ?? change.before}</code></pre>
                  </AccordionContent>
                )}
              </AccordionItem>
            ))}
          </Accordion>
        </ScrollArea>
      )}
    </section>
  );
}
