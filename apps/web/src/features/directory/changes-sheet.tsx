import { HugeiconsIcon } from '@hugeicons/react';
import { InfoIcon, RefreshIcon } from '@hugeicons/core-free-icons';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Checkbox } from '../../components/ui/checkbox';
import { Label } from '../../components/ui/label';
import { ErrorMessage, SheetFrame } from './common';
import { useDirectory } from './context';
import { hasApplyableOperation } from './model';
import { ChangeItem } from './change-item';
import { PlanSummary } from './plan-summary';
import { DirectoryEmpty } from './shared';

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
        <DirectoryEmpty
          icon={<HugeiconsIcon icon={InfoIcon} />}
          title="Nothing staged"
          description="Select resources from the catalog or an installed resource."
        />
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
            {busy && <HugeiconsIcon icon={RefreshIcon} data-icon="inline-start" className="animate-spin" />}
            {busy ? 'Applying…' : plan && plan.plan.changes.length > 0 ? `Apply ${plan.plan.changes.length} file change${plan.plan.changes.length === 1 ? '' : 's'}` : `Apply ${operationCount} operation${operationCount === 1 ? '' : 's'}`}
          </Button>
        </>
      )}
    </SheetFrame>
  );
}
