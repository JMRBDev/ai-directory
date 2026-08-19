import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { harnessLabel, resourceLabel, shortenHomePath, type LocalResource, type StagedItem } from '../../lib/types';
import { LOCAL_STATE_LABELS, REGISTRY_STATE_LABELS } from './model';

export function LocalResourceRow({ resource, homeDirectory, staged, onInstall, onUninstall, onDiscard }: {
  resource: LocalResource;
  homeDirectory: string | undefined;
  staged: StagedItem | undefined;
  onInstall: () => void;
  onUninstall: () => void;
  onDiscard: () => void;
}) {
  const installLabel = resource.state === 'missing' || resource.state === 'modified' ? 'Reinstall' : 'Update';

  return (
    <Card className="rounded-xl">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate font-medium">{resourceLabel(resource)}</p>
              <Badge variant={resource.state === 'managed' ? 'success' : resource.state === 'unmanaged' ? 'muted' : 'warning'}>{LOCAL_STATE_LABELS[resource.state]}</Badge>
              {resource.resource && <Badge variant={resource.registryState === 'current' ? 'success' : resource.registryState === 'outdated' ? 'warning' : 'muted'}>{REGISTRY_STATE_LABELS[resource.registryState]}</Badge>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{resource.type} · {harnessLabel(resource.harness)}{resource.version ? ` · v${resource.version}` : ''}{resource.latestVersion && resource.latestVersion !== resource.version ? ` · latest v${resource.latestVersion}` : ''}</p>
          </div>
          {resource.resource ? staged ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={staged.action === 'uninstall' ? 'destructive' : 'secondary'}>{staged.action === 'uninstall' ? 'Staged for uninstall' : 'Staged for install'}</Badge>
              <Button variant="ghost" size="sm" onClick={onDiscard}>Discard</Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(resource.registryState === 'outdated' || resource.state === 'missing' || resource.state === 'modified') && <Button size="sm" onClick={onInstall}>{installLabel}</Button>}
              <Button variant="ghost" size="sm" onClick={onUninstall}>Uninstall</Button>
            </div>
          ) : null}
        </div>
        <p className="mt-3 truncate font-mono text-xs text-muted-foreground" title={resource.path}>{shortenHomePath(resource.path, homeDirectory)}</p>
        {resource.type === 'mcp-servers' && <p className="mt-2 text-xs text-muted-foreground">{resource.scope === 'project' ? 'Project scope' : 'User scope'}</p>}
      </CardContent>
    </Card>
  );
}
