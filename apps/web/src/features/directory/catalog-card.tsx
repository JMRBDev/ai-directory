import type { ResourceSummary } from '@ai-directory/contracts';
import { Link } from '@tanstack/react-router';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../components/ui/card';
import { detailPath, type Action } from '../../lib/types';
import { cn } from '../../lib/utils';
import { badgeTone } from './shared';
import { updatedLabel } from './model';
import { HugeiconsIcon } from '@hugeicons/react';
import { Tick02Icon } from '@hugeicons/core-free-icons';

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
        'transition-colors',
        stagedAction === 'install' && 'ring-primary',
        stagedAction === 'uninstall' && 'ring-destructive',
      )}
    >
      <CardHeader>
        <CardTitle className="min-w-0">
          <Link className="block truncate hover:text-primary" to={detailPath(resource)}>
            {resource.name}
          </Link>
        </CardTitle>
        <CardDescription className="truncate font-mono">{resource.owner}/{resource.type}</CardDescription>
        {resource.reviewStatus !== 'reviewed' && (
          <CardAction>
            <Badge {...badgeTone('warning')}>Unreviewed</Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="line-clamp-2 text-muted-foreground">{resource.description}</CardContent>
      <CardFooter className="mt-auto justify-between gap-3 border-t">
        <p className="flex min-w-0 items-center gap-2 text-muted-foreground">
          <span className="truncate">
            v{resource.latestVersion} · Updated {updatedLabel(resource.updatedAt)}
          </span>
          {installed && (
            <Badge {...badgeTone('success')}>
              <HugeiconsIcon icon={Tick02Icon} /> Installed
            </Badge>
          )}
          {!installed && presentLocally && <span className="shrink-0">· Local</span>}
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
      </CardFooter>
    </Card>
  );
}
