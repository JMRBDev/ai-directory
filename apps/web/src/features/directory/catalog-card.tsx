import { Check } from '@phosphor-icons/react/dist/csr/Check';
import { Wrench } from '@phosphor-icons/react/dist/csr/Wrench';
import { resourceKey, type ResourceSummary } from '@ai-directory/contracts';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { cn } from '../../lib/utils';
import { detailPath } from '../../lib/types';
import { Link } from '@tanstack/react-router';
import type { Action } from '../../lib/types';
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
  const id = resourceKey(resource);
  const reviewed = resource.reviewStatus === 'reviewed';

  return (
    <Card
      className={cn(
        'relative transition-colors hover:border-primary/50',
        stagedAction === 'install' && 'border-primary bg-primary/5',
        stagedAction === 'uninstall' && 'border-destructive bg-destructive/5',
      )}
    >
      <Button
        className="absolute inset-0 z-0 h-full w-full rounded-lg bg-transparent p-0 hover:bg-transparent hover:text-inherit"
        variant="ghost"
        type="button"
        aria-label={stagedAction ? `Unstage ${id}` : `Stage ${id} for ${installed ? 'uninstall' : 'install'}`}
        aria-pressed={stagedAction !== undefined}
        onClick={onStage}
      >
        <span className="sr-only">{stagedAction ? `Unstage ${id}` : `Stage ${id} for ${installed ? 'uninstall' : 'install'}`}</span>
      </Button>
      <CardContent className="pointer-events-none relative z-10 space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link className="pointer-events-auto block truncate text-lg font-semibold tracking-tight hover:text-primary" to={detailPath(resource)}>
              {resource.name}
            </Link>
            <p className="mt-1 text-xs text-muted-foreground">{resource.owner} · {id}</p>
          </div>
          <Badge variant={reviewed ? 'success' : 'warning'}>{reviewed ? 'Reviewed' : 'Unreviewed'}</Badge>
        </div>
        <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">{resource.description}</p>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground">
          <span>v{resource.latestVersion} · Updated {updatedLabel(resource.updatedAt)}</span>
          <div className="pointer-events-auto flex items-center gap-2">
            {installed && <Badge variant="success"><Check size={13} /> Installed</Badge>}
            {!installed && <Badge variant="muted">Not installed</Badge>}
            {presentLocally && !installed && <Badge variant="muted"><Wrench size={13} /> Local</Badge>}
            <Button variant={stagedAction ? 'secondary' : 'outline'} size="sm" onClick={onStage}>
              {stagedAction === 'install'
                ? 'Staged'
                : stagedAction === 'uninstall'
                  ? 'Unstage removal'
                  : installed
                    ? 'Stage removal'
                    : 'Stage install'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
