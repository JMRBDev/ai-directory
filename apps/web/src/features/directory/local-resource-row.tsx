import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { HugeiconsIcon } from '@hugeicons/react';
import { Copy01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';
import { AccordionContent, AccordionItem, AccordionTrigger } from '../../components/ui/accordion';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { detailPath, RESOURCE_TYPE_LABELS, resourceLabel, shortenHomePath, type LocalResource, type ResourceSummary } from '../../lib/types';
import { useDirectory } from './context';

type StatusTone = 'success' | 'warning' | 'muted';

function statusOf(resource: LocalResource): { label: string; tone: StatusTone } {
  if (resource.state === 'missing') return { label: 'Missing files', tone: 'warning' };
  if (resource.state === 'modified') return { label: 'Changed locally', tone: 'warning' };
  if (resource.registryState === 'outdated') return { label: 'Update available', tone: 'warning' };
  if (resource.state === 'managed') {
    return { label: resource.registryState === 'current' ? 'Up to date' : 'Managed', tone: 'success' };
  }
  return { label: 'Unmanaged', tone: 'muted' };
}

function isActionable(resource: LocalResource): boolean {
  return Boolean(resource.resource)
    && (resource.state === 'missing' || resource.state === 'modified' || resource.registryState === 'outdated');
}

const dotClass: Record<StatusTone, string> = {
  success: 'bg-primary',
  warning: 'bg-amber-500',
  muted: 'bg-muted-foreground/60',
};

const statusTextClass: Record<StatusTone, string> = {
  success: 'text-primary',
  warning: 'text-amber-700 dark:text-amber-300',
  muted: 'text-muted-foreground',
};

export function LocalResourceRow({ itemKey, resource, busy, onInstall, onUninstall }: {
  itemKey: string;
  resource: LocalResource;
  busy: boolean;
  onInstall: () => void;
  onUninstall: () => void;
}) {
  const { homeDirectory } = useDirectory();
  const [copied, setCopied] = useState(false);
  const status = statusOf(resource);
  const actionable = isActionable(resource);
  const installLabel = resource.state === 'missing' || resource.state === 'modified' ? 'Reinstall' : 'Update';
  const parts = resource.resource?.split('/') ?? [];
  const detail = parts.length === 3 && parts[0] && parts[1] && parts[2]
    ? detailPath({ owner: parts[0], type: parts[1] as ResourceSummary['type'], name: parts[2] })
    : undefined;
  const fileCount = resource.files.length;
  const outdated = Boolean(resource.latestVersion && resource.latestVersion !== resource.version);
  const shownFiles = resource.files.slice(0, 6);
  const hiddenFiles = fileCount - shownFiles.length;

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(resource.path);
      setCopied(true);
      toast.success('Path copied.');
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
      toast.error('Could not copy the path.');
    }
  }

  return (
    <AccordionItem value={itemKey} className="px-4">
      <div className="flex items-center gap-2">
        <AccordionTrigger className="min-w-0 flex-1 px-0 py-3 hover:no-underline">
          <span className="flex min-w-0 flex-1 items-start gap-2 text-left">
            <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', dotClass[status.tone])} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="block min-w-0 flex-1 truncate text-sm font-medium" title={resourceLabel(resource)}>
                  {resourceLabel(resource)}
                </span>
                <span className={cn('shrink-0 text-xs font-normal', statusTextClass[status.tone])}>{status.label}</span>
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground tabular-nums">
                {RESOURCE_TYPE_LABELS[resource.type]} · {fileCount} {fileCount === 1 ? 'file' : 'files'}
                {resource.version ? ` · v${resource.version}` : ''}
                {outdated ? ` → v${resource.latestVersion}` : ''}
                {resource.scope ? ` · ${resource.scope}` : ''}
                {resource.source === 'custom' ? ' · Custom' : ''}
              </span>
            </span>
          </span>
        </AccordionTrigger>
        {actionable && (
          <Button size="sm" className="shrink-0" onClick={onInstall} disabled={busy}>
            {busy ? 'Working…' : installLabel}
          </Button>
        )}
      </div>
      <AccordionContent className="px-0">
        <div className="flex flex-col gap-2.5">
          {detail && (
            <Link to={detail} className="w-fit text-xs text-primary hover:underline">
              Open in catalog
            </Link>
          )}
          <div className="flex items-center gap-1.5">
            <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground" title={resource.path}>
              {shortenHomePath(resource.path, homeDirectory)}
            </code>
            <Button variant="ghost" size="icon-xs" onClick={() => void copyPath()} aria-label={`Copy path of ${resource.name}`}>
              <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} />
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {resource.scope ? `Scope ${resource.scope} · ` : ''}
            {resource.sourcePath ? `Folder ${shortenHomePath(resource.sourcePath, homeDirectory)}` : 'Harness folder'}
          </p>
          {fileCount > 0 && (
            <ul className="flex flex-col gap-1 border-t pt-2">
              {shownFiles.map((file) => (
                <li key={file} className="truncate font-mono text-[11px] text-muted-foreground" title={file}>
                  {shortenHomePath(file, homeDirectory)}
                </li>
              ))}
              {hiddenFiles > 0 && (
                <li className="text-[11px] text-muted-foreground tabular-nums">…and {hiddenFiles} more</li>
              )}
            </ul>
          )}
          {resource.resource ? (
            <div>
              <Button variant="ghost" size="sm" onClick={onUninstall} disabled={busy}>
                {busy ? 'Working…' : 'Remove'}
              </Button>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">Unmanaged file. No registry action available.</p>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
