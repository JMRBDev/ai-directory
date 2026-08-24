import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ArrowLeft } from '@phosphor-icons/react/dist/csr/ArrowLeft';
import { FileText } from '@phosphor-icons/react/dist/csr/FileText';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../../components/ui/accordion';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../../components/ui/empty';
import { Skeleton } from '../../components/ui/skeleton';
import { api } from '../../lib/api';
import { RESOURCE_TYPE_LABELS } from '../../lib/types';
import { ErrorMessage } from './feedback';
import { InstallPanel } from './install-panel';
import { updatedLabel } from './model';

export function ResourcePage() {
  const params = useParams({ from: '/resources/$owner/$type/$name' });
  const resourceQuery = useQuery({ queryKey: ['resource', params.owner, params.type, params.name], queryFn: () => api.resource(params.owner, params.type, params.name) });
  const resource = resourceQuery.data?.resource;

  if (resourceQuery.isPending) return <ResourceSkeleton />;
  if (resourceQuery.error || !resource) return <ErrorMessage message={resourceQuery.error instanceof Error ? resourceQuery.error.message : 'Resource not found.'} />;

  const version = resourceQuery.data.version;
  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" asChild>
        <Link to="/"><ArrowLeft size={15} /> Catalog</Link>
      </Button>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{resource.name}</h1>
            <Badge variant="muted">{RESOURCE_TYPE_LABELS[resource.type]}</Badge>
            {resource.reviewStatus !== 'reviewed' && <Badge variant="warning">Unreviewed</Badge>}
          </div>
          <p className="mt-1.5 truncate font-mono text-xs text-muted-foreground">
            {resource.owner}/{resource.type} · v{resource.latestVersion} · Updated {updatedLabel(resource.updatedAt)}
          </p>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">{resource.description}</p>
        </div>
      </div>
      {resourceQuery.data.error && <ErrorMessage message={resourceQuery.data.error} />}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <section aria-labelledby="files-title" className="min-w-0">
          <h2 id="files-title" className="text-sm font-medium">Source files</h2>
          {version ? (
            <Accordion type="multiple" defaultValue={version.files[0] ? [version.files[0].path] : []} className="mt-3 space-y-2">
              {version.files.map((file) => (
                <AccordionItem className="overflow-hidden rounded-lg border" key={file.path} value={file.path}>
                  <AccordionTrigger className="gap-2 px-3 py-2.5 hover:no-underline">
                    <FileText size={15} className="text-muted-foreground" />
                    <code className="min-w-0 flex-1 truncate text-left font-mono text-xs">{file.path}</code>
                  </AccordionTrigger>
                  <AccordionContent className="border-t bg-muted/40 px-4 pb-4 pt-3">
                    <div className="max-h-80 overflow-y-auto rounded-md bg-card">
                      <pre className="whitespace-pre-wrap break-words px-4 py-3 font-mono text-xs leading-5"><code>{file.content}</code></pre>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          ) : !resourceQuery.data.error ? (
            <Empty className="mt-3">
              <EmptyHeader>
                <EmptyMedia><FileText size={18} /></EmptyMedia>
                <EmptyTitle>No files found</EmptyTitle>
                <EmptyDescription>The registry index points to a package with no readable files.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}
        </section>
        <InstallPanel resource={resource} />
      </div>
    </div>
  );
}

function ResourceSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-5 w-24" />
      <div className="space-y-3">
        <Skeleton className="h-7 w-72 max-w-full" />
        <Skeleton className="h-4 w-52 max-w-full" />
        <Skeleton className="h-4 w-full max-w-2xl" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
        <Skeleton className="hidden h-80 rounded-xl lg:block" />
      </div>
    </div>
  );
}
