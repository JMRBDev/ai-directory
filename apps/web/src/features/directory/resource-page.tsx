import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { RESOURCE_TYPE_LABELS } from '../../lib/types';
import { ErrorMessage } from './feedback';
import { InstallPanel } from './install-panel';
import { FilesSection } from './files-section';
import { ResourceSkeleton } from './resource-skeleton';
import { badgeTone } from './shared';
import { updatedLabel } from './model';

export function ResourcePage() {
  const params = useParams({ from: '/resources/$owner/$type/$name' });
  const resourceQuery = useQuery({ queryKey: ['resource', params.owner, params.type, params.name], queryFn: () => api.resource(params.owner, params.type, params.name) });
  const resource = resourceQuery.data?.resource;

  if (resourceQuery.isPending) return <ResourceSkeleton />;
  if (resourceQuery.error || !resource) return <ErrorMessage message={resourceQuery.error instanceof Error ? resourceQuery.error.message : 'Resource not found.'} />;

  const version = resourceQuery.data.version;
  return (
    <div className="flex flex-col gap-6">
      <Button render={<Link to="/" />} variant="ghost" size="sm" className="self-start text-muted-foreground">
        <HugeiconsIcon icon={ArrowLeft01Icon} data-icon="inline-start" /> Catalog
      </Button>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{resource.name}</h1>
            <Badge {...badgeTone('muted')}>{RESOURCE_TYPE_LABELS[resource.type]}</Badge>
            {resource.reviewStatus !== 'reviewed' && <Badge {...badgeTone('warning')}>Unreviewed</Badge>}
          </div>
          <p className="mt-1.5 truncate font-mono text-xs text-muted-foreground">
            {resource.owner}/{resource.type} · v{resource.latestVersion} · Updated {updatedLabel(resource.updatedAt)}
          </p>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">{resource.description}</p>
        </div>
      </div>
      {resourceQuery.data.error && <ErrorMessage message={resourceQuery.data.error} />}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <FilesSection version={version} hasError={Boolean(resourceQuery.data.error)} />
        <InstallPanel resource={resource} />
      </div>
    </div>
  );
}
