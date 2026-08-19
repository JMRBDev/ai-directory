import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ArrowUpRight } from '@phosphor-icons/react/dist/csr/ArrowUpRight';
import { FileText } from '@phosphor-icons/react/dist/csr/FileText';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../../components/ui/accordion';
import { Badge } from '../../components/ui/badge';
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '../../components/ui/breadcrumb';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../../components/ui/empty';
import { ScrollArea } from '../../components/ui/scroll-area';
import { api } from '../../lib/api';
import { RESOURCE_TYPE_LABELS } from '../../lib/types';
import { ErrorMessage, LoadingCard } from './common';
import { useDirectory } from './context';
import { InstallPanel } from './install-panel';
import { updatedLabel } from './model';

export function ResourcePage() {
  const params = useParams({ from: '/resources/$owner/$type/$name' });
  const resourceQuery = useQuery({ queryKey: ['resource', params.owner, params.type, params.name], queryFn: () => api.resource(params.owner, params.type, params.name) });
  const { staged, harnesses, stage, unstage } = useDirectory();
  const id = `${params.owner}/${params.type}/${params.name}`;
  const item = staged[id];
  const resource = resourceQuery.data?.resource;

  if (resourceQuery.isPending) return <LoadingCard />;
  if (resourceQuery.error || !resource) return <ErrorMessage message={resourceQuery.error instanceof Error ? resourceQuery.error.message : 'Resource not found.'} />;

  const version = resourceQuery.data.version;
  return (
    <div className="space-y-8">
      <div>
        <Breadcrumb><BreadcrumbList><BreadcrumbItem><Link className="transition-colors hover:text-foreground" to="/">Catalog</Link></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>{resource.name}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>
        <div className="mt-6 flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
          <div>
            <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{RESOURCE_TYPE_LABELS[resource.type]}</Badge><Badge variant={resource.reviewStatus === 'reviewed' ? 'success' : 'warning'}>{resource.reviewStatus === 'reviewed' ? 'Reviewed' : 'Unreviewed'}</Badge></div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">{resource.name}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{resource.owner} · v{resource.latestVersion} · Updated {updatedLabel(resource.updatedAt)}</p>
          </div>
          <Button variant={item ? 'secondary' : 'default'} onClick={() => item ? unstage(id) : stage({ key: id, resource: id, type: resource.type, action: 'install', harnesses: [...harnesses] })}>{item ? 'Staged in Changes' : 'Stage install'} <ArrowUpRight size={16} /></Button>
        </div>
        <p className="mt-6 max-w-3xl text-base leading-7 text-muted-foreground">{resource.description}</p>
      </div>
      {resourceQuery.data.error && <ErrorMessage message={resourceQuery.data.error} />}
      {version ? <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileText size={18} /> Source files</CardTitle></CardHeader><CardContent><Accordion type="multiple" defaultValue={version.files[0] ? [version.files[0].path] : []} className="space-y-2">{version.files.map((file) => <AccordionItem className="overflow-hidden rounded-lg border" key={file.path} value={file.path}><AccordionTrigger className="px-3 py-2 hover:no-underline"><code className="font-mono text-xs">{file.path}</code></AccordionTrigger><AccordionContent className="border-t bg-muted/40 px-4 pb-4 pt-3"><ScrollArea className="h-80"><pre className="text-xs leading-5"><code>{file.content}</code></pre></ScrollArea></AccordionContent></AccordionItem>)}</Accordion></CardContent></Card> : !resourceQuery.data.error ? <Empty><EmptyHeader><EmptyMedia><FileText size={20} /></EmptyMedia><EmptyTitle>No files found</EmptyTitle><EmptyDescription>The registry index points to a package with no readable files.</EmptyDescription></EmptyHeader></Empty> : null}
      <InstallPanel resource={resource} staged={item} />
    </div>
  );
}
