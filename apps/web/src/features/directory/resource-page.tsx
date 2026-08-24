import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ArrowLeft } from '@phosphor-icons/react/dist/csr/ArrowLeft';
import { FileText } from '@phosphor-icons/react/dist/csr/FileText';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../../components/ui/accordion';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../../components/ui/empty';
import { Skeleton } from '../../components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '../../components/ui/toggle-group';
import { MarkdownView } from '../../components/markdown-view';
import { api } from '../../lib/api';
import { RESOURCE_TYPE_LABELS } from '../../lib/types';
import { ErrorMessage } from './feedback';
import { InstallPanel } from './install-panel';
import { isMarkdownPath, stripFrontmatter, updatedLabel } from './model';

export function ResourcePage() {
  const params = useParams({ from: '/resources/$owner/$type/$name' });
  const resourceQuery = useQuery({ queryKey: ['resource', params.owner, params.type, params.name], queryFn: () => api.resource(params.owner, params.type, params.name) });
  const resource = resourceQuery.data?.resource;
  const [view, setView] = useState<'rendered' | 'text'>('rendered');
  const files = useMemo(() => resourceQuery.data?.version?.files ?? [], [resourceQuery.data]);
  const hasMarkdown = useMemo(() => files.some((file) => isMarkdownPath(file.path)), [files]);

  if (resourceQuery.isPending) return <ResourceSkeleton />;
  if (resourceQuery.error || !resource) return <ErrorMessage message={resourceQuery.error instanceof Error ? resourceQuery.error.message : 'Resource not found.'} />;

  const version = resourceQuery.data.version;
  return (
    <div className="flex flex-col gap-6">
      <Button variant="ghost" size="sm" className="self-start text-muted-foreground" asChild>
        <Link to="/"><ArrowLeft size={15} /> Catalog</Link>
      </Button>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-2xl">{resource.name}</h1>
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
          <div className="mt-3 flex items-center justify-between gap-3">
            <h2 id="files-title" className="text-sm font-medium">Source files</h2>
            {hasMarkdown && (
              <ToggleGroup
                className="w-auto"
                value={[view]}
                onValueChange={(value) => { const next = value[0]; if (next === 'rendered' || next === 'text') setView(next); }}
                aria-label="File view mode"
              >
                <ToggleGroupItem value="rendered">Rendered</ToggleGroupItem>
                <ToggleGroupItem value="text">Text</ToggleGroupItem>
              </ToggleGroup>
            )}
          </div>
          {version ? (
            <Accordion multiple defaultValue={version.files[0] ? [version.files[0].path] : []} className="mt-3">
              {version.files.map((file) => (
                <AccordionItem key={file.path} value={file.path}>
                  <AccordionTrigger className="gap-2 px-3 py-2.5 hover:no-underline">
                    <FileText size={15} className="text-muted-foreground" />
                    <code className="min-w-0 flex-1 truncate text-left font-mono">{file.path}</code>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-3 pt-1">
                    {isMarkdownPath(file.path) && view === 'rendered' ? (
                      <div className="max-h-80 overflow-y-auto">
                        <MarkdownView content={stripFrontmatter(file.content)} />
                      </div>
                    ) : (
                      <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words font-mono leading-5"><code>{file.content}</code></pre>
                    )}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          ) : !resourceQuery.data.error ? (
            <Empty className="mt-3">
              <EmptyHeader>
                <EmptyMedia variant="icon"><FileText /></EmptyMedia>
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
    <div className="flex flex-col gap-6">
      <Skeleton className="h-5 w-24" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-7 w-72 max-w-full" />
        <Skeleton className="h-4 w-52 max-w-full" />
        <Skeleton className="h-4 w-full max-w-2xl" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
        <Skeleton className="hidden h-80 rounded-xl lg:block" />
      </div>
    </div>
  );
}
