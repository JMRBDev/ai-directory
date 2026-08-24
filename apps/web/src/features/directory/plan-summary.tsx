import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../../components/ui/accordion';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { ScrollArea } from '../../components/ui/scroll-area';
import { harnessLabel, shortenHomePath, type ChangePlan } from '../../lib/types';
import { useDirectory } from './context';

export function PlanSummary({ plan }: { plan: ChangePlan }) {
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
