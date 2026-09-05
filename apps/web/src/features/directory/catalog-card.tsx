import { resourceKey, type ResourceSummary } from '@ai-directory/contracts';
import { Link } from '@tanstack/react-router';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../components/ui/card';
import { detailPath } from '../../lib/types';
import { useDirectory } from './context';
import { badgeTone } from './shared';
import { updatedLabel } from './model';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon, PlayListAddIcon, Tick02Icon } from '@hugeicons/core-free-icons';

export function CatalogCard({
  resource,
  installed,
  presentLocally,
}: {
  resource: ResourceSummary;
  installed: boolean;
  presentLocally: boolean;
}) {
  const { selection, toggleSelected } = useDirectory();
  const id = resourceKey(resource);
  const selected = selection.some((entry) => entry.id === id);

  return (
    <Card>
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
              <HugeiconsIcon icon={Tick02Icon} data-icon="inline-start" /> Installed
            </Badge>
          )}
          {!installed && presentLocally && <span className="shrink-0">· Local</span>}
        </p>
        {installed ? (
          <Button
            render={<Link to={detailPath(resource)} />}
            variant="secondary"
            size="sm"
          >
            Manage
          </Button>
        ) : (
          <Button
            variant={selected ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => toggleSelected(id)}
            aria-pressed={selected}
            aria-label={selected ? `Remove ${id} from batch install` : `Add ${id} to batch install`}
          >
            <HugeiconsIcon icon={selected ? Cancel01Icon : PlayListAddIcon} data-icon="inline-start" />
            {selected ? 'Remove' : 'Add'}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
