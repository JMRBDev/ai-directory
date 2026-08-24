import { Check } from '@phosphor-icons/react/dist/csr/Check';
import type { ResourceSummary } from '@ai-directory/contracts';
import { Link } from '@tanstack/react-router';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { detailPath, type Action } from '../../lib/types';
import { cn } from '../../lib/utils';
import { updatedLabel } from './model';

export function CatalogCard({
  resource,
  installed,
  presentLocally,
  stagedAction,
  onStage,
}: {
  resource: ResourceSummary;
  installed: boolean;
  presentLocally: boolean;
  stagedAction: Action | undefined;
  onStage: () => void;
}) {
  return (
    <Card
      className={cn(
        'flex flex-col gap-3 p-5 transition-colors',
        stagedAction === 'install' && 'border-primary/50 ring-1 ring-primary/20',
        stagedAction === 'uninstall' && 'border-destructive/40 ring-1 ring-destructive/15',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link className="block truncate font-medium tracking-tight hover:text-primary" to={detailPath(resource)}>
            {resource.name}
          </Link>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{resource.owner}/{resource.type}</p>
        </div>
        {resource.reviewStatus !== 'reviewed' && <Badge variant="warning">Unreviewed</Badge>}
      </div>
      <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">{resource.description}</p>
      <div className="mt-auto flex items-center justify-between gap-3 border-t pt-3">
        <p className="flex min-w-0 items-center text-xs text-muted-foreground">
          <span className="truncate">
            v{resource.latestVersion} · Updated {updatedLabel(resource.updatedAt)}
          </span>
          {installed && (
            <span className="ml-2 inline-flex shrink-0 items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
              <Check size={13} weight="bold" /> Installed
            </span>
          )}
          {!installed && presentLocally && <span className="ml-2 shrink-0">· Local</span>}
        </p>
        <Button
          variant={stagedAction ? 'secondary' : 'outline'}
          size="sm"
          aria-pressed={stagedAction !== undefined}
          onClick={onStage}
        >
          {stagedAction === 'install'
            ? 'Staged'
            : stagedAction === 'uninstall'
              ? 'Removal staged'
              : installed
                ? 'Remove'
                : 'Install'}
        </Button>
      </div>
    </Card>
  );
}
