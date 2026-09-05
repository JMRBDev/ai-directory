import { useDirectory } from './context';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { harnessLabel, resourceLabel, shortenHomePath, type LocalResource } from '../../lib/types';
import { badgeTone } from './shared';
import { LOCAL_STATE_LABELS, REGISTRY_STATE_LABELS } from './model';

export function LocalResourceRow({ resource, busy, onInstall, onUninstall }: {
  resource: LocalResource;
  busy: boolean;
  onInstall: () => void;
  onUninstall: () => void;
}) {
  const { homeDirectory } = useDirectory();
  const installLabel = resource.state === 'missing' || resource.state === 'modified' ? 'Reinstall' : 'Update';
  const stateTone = resource.state === 'managed' ? 'success' : resource.state === 'unmanaged' ? 'muted' : 'warning';
  const registryTone = resource.registryState === 'current' ? 'success' : resource.registryState === 'outdated' ? 'warning' : 'muted';
  const outdated = Boolean(resource.latestVersion && resource.latestVersion !== resource.version);

  return (
    <li className="flex items-start justify-between gap-3 py-3.5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="truncate text-sm font-medium">{resourceLabel(resource)}</p>
          <Badge {...badgeTone(stateTone)}>{LOCAL_STATE_LABELS[resource.state]}</Badge>
          {resource.resource && <Badge {...badgeTone(registryTone)}>{REGISTRY_STATE_LABELS[resource.registryState]}</Badge>}
        </div>
        <p className="mt-1 truncate font-mono text-xs text-muted-foreground" title={resource.path}>
          {harnessLabel(resource.harness)} · {shortenHomePath(resource.path, homeDirectory)}
        </p>
        {(resource.version || outdated) && (
          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
            {resource.version ? `v${resource.version}` : ''}
            {resource.version && outdated ? ' → ' : ''}
            {outdated ? `v${resource.latestVersion} available` : ''}
          </p>
        )}
      </div>
      {resource.resource ? (
        <div className="flex shrink-0 gap-2">
          {(resource.registryState === 'outdated' || resource.state === 'missing' || resource.state === 'modified') && (
            <Button size="sm" onClick={onInstall} disabled={busy}>{busy ? 'Working…' : installLabel}</Button>
          )}
          <Button variant="ghost" size="sm" onClick={onUninstall} disabled={busy}>{busy ? 'Working…' : 'Remove'}</Button>
        </div>
      ) : null}
    </li>
  );
}
