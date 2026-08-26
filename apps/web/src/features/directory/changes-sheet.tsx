import { useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon, InfoIcon, RefreshIcon } from '@hugeicons/core-free-icons';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../../components/ui/accordion';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Label } from '../../components/ui/label';
import { Skeleton } from '../../components/ui/skeleton';
import type { Harness, PlanChange, StagedItem } from '../../lib/types';
import { harnessLabel, shortenHomePath } from '../../lib/types';
import { cn } from '../../lib/utils';
import { ErrorMessage, SheetFrame } from './common';
import { useDirectory } from './context';
import { hasApplyableOperation } from './model';
import { accordionContentClass, accordionTriggerClass, badgeTone, DirectoryEmpty, HarnessToggleGroup, ScopeToggleGroup } from './shared';

type StagedGroup = { key: string; name: string; item?: StagedItem; changes: PlanChange[] };

const actionTones = {
  added: 'success',
  modified: 'warning',
  removed: 'destructive',
} as const;

function itemName(resource: string) {
  return resource.split('/')[2] ?? resource;
}

function changeCounts(changes: PlanChange[]) {
  const counts = { added: 0, modified: 0, removed: 0 };
  for (const change of changes) counts[change.action] += 1;
  return counts;
}

function countsLabel(counts: { added: number; modified: number; removed: number }) {
  return [
    counts.added > 0 ? `+${counts.added}` : undefined,
    counts.modified > 0 ? `~${counts.modified}` : undefined,
    counts.removed > 0 ? `−${counts.removed}` : undefined,
  ].filter(Boolean).join(' ');
}

function compactWarnings(warnings: string[]) {
  return [...new Set(warnings.map((warning) => warning.split('@')[0]?.split('/')[2] ?? warning))];
}

function groupByHarness(changes: PlanChange[]) {
  const byHarness = new Map<Harness, PlanChange[]>();
  for (const change of changes) {
    byHarness.set(change.harness, [...(byHarness.get(change.harness) ?? []), change]);
  }
  return [...byHarness.entries()];
}

function FileRow({ change, homeDirectory }: { change: PlanChange; homeDirectory: string | undefined }) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = Boolean(change.before || change.after);

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center justify-between gap-2 rounded-md text-left"
      >
        <code className="min-w-0 flex-1 truncate font-mono text-xs" title={change.path}>
          {shortenHomePath(change.path, homeDirectory)}
        </code>
        {hasContent && (
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={14}
            className={cn('shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')}
          />
        )}
        <Badge {...badgeTone(actionTones[change.action])}>{change.action}</Badge>
      </button>
      {expanded && hasContent && (
        <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted/60 p-2 font-mono text-xs leading-5">
          <code>
            {change.action === 'modified'
              ? `− ${change.before ?? '(did not exist)'}\n+ ${change.after ?? '(removed)'}`
              : change.after ?? change.before}
          </code>
        </pre>
      )}
    </div>
  );
}

function groupChanges(items: StagedItem[], changes: PlanChange[]): StagedGroup[] {
  const changesByResource = new Map<string, PlanChange[]>();
  for (const change of changes) {
    changesByResource.set(change.resource, [...(changesByResource.get(change.resource) ?? []), change]);
  }

  const groups: StagedGroup[] = items.map((item) => ({
    key: item.key,
    name: itemName(item.resource),
    item,
    changes: changesByResource.get(item.resource) ?? [],
  }));

  const stagedResources = new Set(items.map((item) => item.resource));
  const leftovers = changes.filter((change) => !stagedResources.has(change.resource));
  if (leftovers.length > 0) {
    const packItems = items.filter((item) => item.type === 'templates');
    const pack = packItems.length === 1 ? packItems[0] : undefined;
    if (pack) {
      groups.find((group) => group.key === pack.key)?.changes.push(...leftovers);
    } else {
      groups.push({ key: 'template-members', name: 'Template members', changes: leftovers });
    }
  }

  return groups;
}

export function ChangesSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const {
    staged,
    harnesses,
    homeDirectory,
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
  const groups = plan ? groupChanges(items, plan.plan.changes) : [];

  function renderGroup({ group, defaultHarnesses }: { group: StagedGroup; defaultHarnesses: Harness[] }) {
    const item = group.item;
    return (
      <AccordionItem key={group.key} value={group.key}>
        <AccordionTrigger className={accordionTriggerClass}>
          <span className="min-w-0 flex-1 truncate text-left text-sm font-medium">{group.name}</span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            {group.changes.length > 0 ? countsLabel(changeCounts(group.changes)) : 'no file changes'}
          </span>
        </AccordionTrigger>
        <AccordionContent className={accordionContentClass}>
          <div className="flex flex-col gap-4">
            {item && (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs text-muted-foreground">Install for</p>
                <HarnessToggleGroup
                  ariaLabel={`Harnesses for ${group.name}`}
                  value={item.harnesses.length > 0 ? item.harnesses : defaultHarnesses}
                  onValueChange={(next) => updateStage({ ...item, harnesses: next })}
                  disabled={busy}
                />
              </div>
            )}
            {item?.type === 'mcp-servers' && (
              <ScopeToggleGroup
                ariaLabel={`Scope for ${group.name}`}
                value={item.scope ?? 'user'}
                onValueChange={(scope) => updateStage({ ...item, scope })}
                disabled={busy}
              />
            )}
            {groupByHarness(group.changes).map(([harness, harnessChanges]) => (
              <div key={harness} className="flex flex-col gap-1.5">
                <p className="text-xs font-medium text-muted-foreground">
                  {harnessLabel(harness)} · {harnessChanges.length} file{harnessChanges.length === 1 ? '' : 's'}
                </p>
                {harnessChanges.map((change) => (
                  <FileRow key={`${change.harness}:${change.path}`} change={change} homeDirectory={homeDirectory} />
                ))}
              </div>
            ))}
            {group.changes.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No file changes · updates registry records only.
              </p>
            )}
            {item && (
              <div>
                <Button variant="ghost" size="sm" onClick={() => unstage(item.key)} disabled={busy}>
                  Remove from changes
                </Button>
              </div>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>
    );
  }

  return (
    <SheetFrame open={open} onOpenChange={onOpenChange} title="Changes" description="Review staged resources, then apply them to your machine.">
      {items.length === 0 ? (
        <DirectoryEmpty
          icon={<HugeiconsIcon icon={InfoIcon} />}
          title="Nothing staged"
          description="Select resources from the catalog or an installed resource."
        />
      ) : (
        <>
          {plan?.plan.conflicts.length ? (
            <Alert variant="destructive">
              <AlertDescription>{plan.plan.conflicts.join(' ')}</AlertDescription>
            </Alert>
          ) : null}
          {plan && plan.plan.warnings.length > 0 && (
            <p className="truncate text-xs text-muted-foreground" title={plan.plan.warnings.join(', ')}>
              Unreviewed: {compactWarnings(plan.plan.warnings).join(', ')}
            </p>
          )}
          {planLoading && (
            <div className="flex flex-col gap-2" aria-hidden>
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-24 w-full rounded-lg" />
            </div>
          )}
          {planError && <ErrorMessage message={planError} />}
          {plan && groups.length > 0 && (
            <Accordion multiple>
              {groups.map((group) => renderGroup({ group, defaultHarnesses: harnesses }))}
            </Accordion>
          )}
          <div className="sticky bottom-0 -mx-6 -mb-6 flex flex-col gap-3 border-t bg-background/95 px-6 pb-6 pt-4 backdrop-blur">
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
            <div className="flex items-center justify-between gap-3">
              <Button variant="ghost" size="sm" onClick={clear} disabled={busy}>Discard all</Button>
              <Button onClick={applyChanges} disabled={!canApply}>
                {busy && <HugeiconsIcon icon={RefreshIcon} data-icon="inline-start" className="animate-spin" />}
                {busy ? 'Applying…' : 'Apply changes'}
              </Button>
            </div>
          </div>
        </>
      )}
    </SheetFrame>
  );
}
