import { useState } from 'preact/hooks';
import DrawerShell from './DrawerShell';
import { closeDrawers } from './api';
import { useChangeDeck, type StagedItem } from './ChangeDeckContext';
import { harnessOptions, shortenHomePath } from './types';
import type { Action, Harness, LocalResource } from './types';

type Props = {
  homeDir: string;
};

type HarnessFilter = 'all' | Harness;
type SourceFilter = 'all' | 'registry' | 'local';

// SAFETY: harnessOptions lists every harness in the Harness union.
const harnessLabels = Object.fromEntries(
  harnessOptions.map((option) => [option.value, option.label]),
) as Record<Harness, string>;

const typeLabels = {
  skills: 'Skill',
  agents: 'Agent',
  rules: 'Rule',
  'mcp-servers': 'MCP Server',
} satisfies Record<LocalResource['type'], string>;

const typeIcons = {
  skills: 'ph-lightning',
  agents: 'ph-user-circle-gear',
  rules: 'ph-scroll',
  'mcp-servers': 'ph-plugs-connected',
} satisfies Record<LocalResource['type'], string>;

function stateLabel(state: LocalResource['state']) {
  return state === 'managed'
    ? 'Managed'
    : state === 'modified'
      ? 'Modified'
      : state === 'missing'
        ? 'Missing'
        : 'Unmanaged';
}

function stateClass(state: LocalResource['state']) {
  return state === 'managed'
    ? 'badge-success'
    : state === 'modified' || state === 'missing'
      ? 'badge-warning'
      : 'badge-ghost';
}

function registryStateLabel(state: LocalResource['registryState']) {
  return state === 'current' ? 'Current' : state === 'outdated' ? 'Outdated' : 'Unknown';
}

function registryStateClass(state: LocalResource['registryState']) {
  return state === 'current'
    ? 'badge-success'
    : state === 'outdated'
      ? 'badge-warning'
      : 'badge-ghost';
}

function resourceLabel(resource: LocalResource) {
  return resource.resource ?? `local/${resource.type}/${resource.name}`;
}

function installActionLabel(resource: LocalResource) {
  return resource.state === 'missing' || resource.state === 'modified' ? 'Reinstall' : 'Update';
}

export default function InstalledResources({ homeDir }: Props) {
  const {
    localResources,
    localRegistryError,
    localLoading,
    staged,
    stage,
    unstage,
    busy,
    loadLocalResources,
  } = useChangeDeck();
  const [harness, setHarness] = useState<HarnessFilter>('all');
  const [source, setSource] = useState<SourceFilter>('all');

  const visibleResources = localResources.filter((resource) =>
    (harness === 'all' || resource.harness === harness)
    && (source === 'all'
      || (source === 'registry' ? resource.resource !== undefined : resource.resource === undefined)),
  );
  const statusText = localLoading
    ? 'Scanning known harness locations…'
    : visibleResources.length === 0
      ? 'No resources found in the known harness locations.'
      : visibleResources.length + ' local resource' + (visibleResources.length === 1 ? '' : 's') + ' found.';

  function stagedKey(resource: LocalResource): string {
    return `${resource.resource ?? ''}\u0000${resource.harness}`;
  }

  function stageResource(resource: LocalResource, action: Action) {
    if (!resource.resource) return;
    const item: StagedItem = {
      key: stagedKey(resource),
      resource: resource.resource,
      type: resource.type,
      action,
      harnesses: [resource.harness],
    };
    if (resource.type === 'mcp-servers' && resource.scope) item.scope = resource.scope;
    stage(item);
  }

  return (
    <DrawerShell
      id="installed-drawer-toggle"
      title="Installed resources"
      onOpen={() => {
        closeDrawers('change-deck-toggle', 'settings-drawer-toggle', 'publish-drawer-toggle');
        void loadLocalResources();
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-xl text-sm text-base-content/60">
          Resources installed in your user and project harness setups. Stage an action and review it in the Changes panel.
        </p>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => void loadLocalResources()} disabled={localLoading}>
          <i className="ph ph-arrow-clockwise" aria-hidden="true"></i>
          Refresh
        </button>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="fieldset">
          <span className="fieldset-legend">Harness</span>
          <select className="select w-full" value={harness} onChange={(event) => {
            // SAFETY: The select options are exactly the HarnessFilter values.
            setHarness(event.currentTarget.value as HarnessFilter);
          }}>
            <option value="all">All harnesses</option>
            <option value="claude-code">Claude Code</option>
            <option value="opencode">OpenCode</option>
            <option value="codex">Codex</option>
          </select>
        </label>
        <label className="fieldset">
          <span className="fieldset-legend">Source</span>
          <select className="select w-full" value={source} onChange={(event) => {
            // SAFETY: The select options are exactly the SourceFilter values.
            setSource(event.currentTarget.value as SourceFilter);
          }}>
            <option value="all">All sources</option>
            <option value="registry">From this registry</option>
            <option value="local">Not from this registry</option>
          </select>
        </label>
      </div>

      <p className={'mt-5 text-sm text-base-content/60'} role="status" aria-live="polite">
        {statusText}
      </p>

      {localRegistryError && (
        <div className={'alert mt-4 items-start text-sm ' + (localResources.length === 0 ? 'alert-error' : 'alert-warning')} role={localResources.length === 0 ? 'alert' : 'status'}>
          <i className={'ph text-lg ' + (localResources.length === 0 ? 'ph-warning-circle' : 'ph-info')} aria-hidden="true"></i>
          <span>{localRegistryError}</span>
        </div>
      )}

      {visibleResources.length > 0 ? (
        <ul className="list mt-4 gap-2" aria-label="Local resources">
          {visibleResources.map((resource) => {
            const id = resource.resource;
            const key = stagedKey(resource);
            const stagedItem = id ? staged[key] : undefined;
            return (
              <li className="list-row list-col-wrap gap-3 bg-base-200" key={`${resource.harness}:${resource.path}`}>
                <div className="flex size-10 shrink-0 items-center justify-center rounded-box bg-base-300 text-lg text-base-content/60">
                  <i className={'ph ' + typeIcons[resource.type]} aria-hidden="true"></i>
                </div>
                <div className="list-col-grow min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="break-all text-sm text-base-content">{resourceLabel(resource)}</strong>
                    <span className={'badge badge-sm ' + stateClass(resource.state)}>{stateLabel(resource.state)}</span>
                    {resource.resource && <span className={'badge badge-sm ' + registryStateClass(resource.registryState)}>{registryStateLabel(resource.registryState)}</span>}
                    {resource.type === 'mcp-servers' && (
                      <span className="badge badge-ghost badge-sm gap-1">
                        <i className="ph ph-globe-hemisphere-west text-xs" aria-hidden="true"></i>
                        {resource.scope === 'project' ? 'Project' : 'User'}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-base-content/60">
                    {typeLabels[resource.type]} · {harnessLabels[resource.harness]}
                    {resource.version ? ` · v${resource.version}` : ''}
                    {resource.latestVersion && resource.latestVersion !== resource.version ? ` · latest v${resource.latestVersion}` : ''}
                  </p>
                  <code className="mt-2 block truncate text-xs text-base-content/50" title={resource.path}>{shortenHomePath(resource.path, homeDir)}</code>
                  {id ? (
                    stagedItem ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className={'badge badge-sm gap-1 ' + (stagedItem.action === 'uninstall' ? 'badge-error badge-soft' : 'badge-primary badge-soft')}>
                          <i className={'ph ' + (stagedItem.action === 'uninstall' ? 'ph-trash' : 'ph-download-simple')} aria-hidden="true"></i>
                          Staged for {stagedItem.action === 'uninstall' ? 'uninstall' : 'install'}
                        </span>
                        <button className="btn btn-ghost btn-xs" type="button" onClick={() => unstage(key)} disabled={busy}>Discard</button>
                      </div>
                    ) : (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(resource.registryState === 'outdated' || resource.state === 'missing' || resource.state === 'modified') && (
                          <button className="btn btn-primary btn-xs" type="button" onClick={() => stageResource(resource, 'install')} disabled={busy}>
                            <i className="ph ph-arrow-clockwise" aria-hidden="true"></i>
                            {installActionLabel(resource)}
                          </button>
                        )}
                        <button className="btn btn-ghost btn-xs text-error" type="button" onClick={() => stageResource(resource, 'uninstall')} disabled={busy}>
                          <i className="ph ph-trash" aria-hidden="true"></i>
                          Uninstall
                        </button>
                      </div>
                    )
                  ) : (
                    <p className="mt-3 text-xs text-base-content/50">Unmanaged local resource</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : localResources.length > 0 ? (
        <div className="alert alert-info mt-4 items-start text-sm">
          <i className="ph ph-funnel" aria-hidden="true"></i>
          <span>No local resources match these filters.</span>
        </div>
      ) : null}
    </DrawerShell>
  );
}
