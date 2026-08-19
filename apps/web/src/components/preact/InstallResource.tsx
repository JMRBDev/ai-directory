import type { ResourceType } from '@ai-directory/contracts';
import { useRef, useState } from 'preact/hooks';
import { closeDrawers } from './api';
import type { StagedItem, StagedMap } from './ChangeDeckContext';
import {
  DRAWER_TOGGLES,
  HARNESS_DEFAULTS_EVENT,
  readStagedChanges,
  readHarnessDefaults,
  STAGED_CHANGES_EVENT,
  STAGE_RESOURCE_EVENT,
  UNSTAGE_RESOURCE_EVENT,
} from './lib';
import { harnessOptions, scopeOptions, type Harness, type InstallScope } from './types';
import { useMountEffect } from './useMountEffect';

type Props = {
  resourceKey: string;
  resourceType: ResourceType;
};

function commandFor(resourceKey: string, harnesses: Harness[], resourceType: ResourceType, scope: InstallScope) {
  if (harnesses.length === 0) return '';
  const harnessFlags = harnesses.map((harness) => `--harness ${harness}`).join(' ');
  const scopeFlag = resourceType === 'mcp-servers' ? ` --scope ${scope}` : '';
  return `aid install ${resourceKey} ${harnessFlags}${scopeFlag}`;
}

function openChanges() {
  closeDrawers(DRAWER_TOGGLES.installed, DRAWER_TOGGLES.settings, DRAWER_TOGGLES.publish);
  // SAFETY: DrawerShell renders the Changes toggle as an input with this id.
  const toggle = document.getElementById(DRAWER_TOGGLES.changeDeck) as HTMLInputElement | null;
  if (toggle) toggle.checked = true;
}

export default function InstallResource({ resourceKey, resourceType }: Props) {
  const isMcp = resourceType === 'mcp-servers';
  const [harnesses, setHarnesses] = useState<Harness[]>(() => readHarnessDefaults());
  const [scope, setScope] = useState<InstallScope>('user');
  const [copied, setCopied] = useState(false);
  const [stagedItem, setStagedItem] = useState<StagedItem | undefined>(undefined);
  const stagedItemRef = useRef<StagedItem | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const command = commandFor(resourceKey, harnesses, resourceType, scope);
  const isStaged = stagedItem !== undefined;

  function syncStagedItem(staged: StagedMap) {
    const nextItem = staged[resourceKey];
    const previousItem = stagedItemRef.current;
    stagedItemRef.current = nextItem;
    setStagedItem(nextItem);
    if (!nextItem) {
      if (previousItem) setHarnesses(readHarnessDefaults());
      return;
    }
    setHarnesses(nextItem.harnesses);
    if (isMcp && nextItem.scope) setScope(nextItem.scope);
  }

  useMountEffect(() => {
    syncStagedItem(readStagedChanges());
    setReady(true);
    const handleStagedChanges = (event: Event) => {
      // SAFETY: persistStagedChanges dispatches this event with a StagedMap detail.
      const staged = (event as CustomEvent<StagedMap>).detail;
      syncStagedItem(staged ?? readStagedChanges());
    };
    const handleHarnessDefaults = (event: Event) => {
      // SAFETY: persistHarnessDefaults dispatches this event with a Harness[] detail.
      const defaults = (event as CustomEvent<Harness[]>).detail;
      if (Array.isArray(defaults) && defaults.length > 0 && !stagedItemRef.current) setHarnesses(defaults);
    };
    window.addEventListener(STAGED_CHANGES_EVENT, handleStagedChanges);
    window.addEventListener(HARNESS_DEFAULTS_EVENT, handleHarnessDefaults);
    return () => {
      window.removeEventListener(STAGED_CHANGES_EVENT, handleStagedChanges);
      window.removeEventListener(HARNESS_DEFAULTS_EVENT, handleHarnessDefaults);
    };
  });

  if (!ready) {
    return (
      <section className="mt-14" aria-labelledby="install-title" data-resource-install data-resource-id={resourceKey} data-resource-type={resourceType} aria-busy="true">
        <h2 id="install-title" className="text-xl font-semibold tracking-tight text-base-content">Install this resource</h2>
        <div className="card card-border mt-5 bg-base-100" role="status">
          <div className="card-body gap-3 p-5 sm:p-6">
            <span className="skeleton h-4 w-2/5"></span>
            <span className="skeleton h-10 w-full"></span>
            <span className="skeleton h-10 w-4/5"></span>
          </div>
        </div>
      </section>
    );
  }

  function updateHarness(harness: Harness, checked: boolean) {
    setHarnesses((current) => {
      const selected = checked
        ? [...current, harness]
        : current.filter((candidate) => candidate !== harness);
      return harnessOptions
        .map((option) => option.value)
        .filter((candidate) => selected.includes(candidate));
    });
  }

  function stageResource() {
    if (harnesses.length === 0) return;
    const item: StagedItem = {
      key: resourceKey,
      resource: resourceKey,
      type: resourceType,
      action: 'install',
      harnesses: [...harnesses],
    };
    if (isMcp) item.scope = scope;
    stagedItemRef.current = item;
    setStagedItem(item);
    window.dispatchEvent(new CustomEvent(STAGE_RESOURCE_EVENT, { detail: item }));
    openChanges();
  }

  function removeResource() {
    setStagedItem(undefined);
    window.dispatchEvent(new CustomEvent(UNSTAGE_RESOURCE_EVENT, { detail: { key: resourceKey } }));
  }

  async function copyCommand() {
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="mt-14" aria-labelledby="install-title" data-resource-install data-resource-id={resourceKey} data-resource-type={resourceType}>
      <h2 id="install-title" className="text-xl font-semibold tracking-tight text-base-content">Install this resource</h2>
      <p className="mt-2 text-sm text-base-content/60">Choose where to install it, then review the request in Changes.</p>

      {resourceType === 'templates' && (
        <div className="alert alert-info mt-5 items-start text-sm leading-6" role="status">
          <i className="ph ph-package text-xl" aria-hidden="true"></i>
          <span>Templates install their component resources together.</span>
        </div>
      )}

      <div className="card card-border mt-5 bg-base-100">
        <div className="card-body gap-6 p-5 sm:p-6">
          <fieldset className="fieldset">
            <legend className="fieldset-legend text-base">Install in</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {harnessOptions.map((option) => {
                const selected = harnesses.includes(option.value);
                return (
                  <label
                    className={'label cursor-pointer justify-start gap-3 rounded-field border px-3 py-3 transition-colors ' + (selected ? 'border-primary/50 bg-primary/5' : 'border-base-300')}
                    key={option.value}
                  >
                    <input
                      className="checkbox checkbox-primary"
                      type="checkbox"
                      value={option.value}
                      checked={selected}
                      onChange={(event) => updateHarness(option.value, event.currentTarget.checked)}
                    />
                    <span className="font-medium text-base-content">{option.label}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {isMcp && (
            <fieldset className="fieldset border-t border-base-300 pt-5">
              <legend className="fieldset-legend text-base">Scope</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {scopeOptions.map((option) => (
                  <label className="label cursor-pointer justify-start gap-3 rounded-field border border-base-300 px-3 py-3" key={option.value}>
                    <input
                      className="radio radio-primary"
                      type="radio"
                      name="mcp-install-scope"
                      value={option.value}
                      checked={scope === option.value}
                      onChange={() => setScope(option.value)}
                    />
                    <span>
                      <span className="block font-medium text-base-content">{option.label}</span>
                      <span className="block text-xs text-base-content/60">{option.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <div className="border-t border-base-300 pt-5">
            <div className="flex min-w-0 items-center gap-3 rounded-field bg-base-200 px-3 py-2">
              <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs leading-6 text-base-content" aria-live="polite">
                {command || 'Select a harness to generate a command.'}
              </code>
              <button className="btn btn-ghost btn-square btn-sm shrink-0" type="button" onClick={() => void copyCommand()} disabled={!command} title="Copy install command" aria-label="Copy install command">
                <i className={'ph ' + (copied ? 'ph-check' : 'ph-copy-simple')} aria-hidden="true"></i>
              </button>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-base-content/60" role="status" aria-live="polite">
                {harnesses.length === 0
                  ? 'Select at least one harness.'
                  : isStaged
                    ? 'Saved in Changes.'
                    : `${harnesses.length} harness${harnesses.length === 1 ? '' : 'es'} selected.`}
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                {isStaged && (
                  <button className="btn btn-ghost" type="button" onClick={removeResource}>
                    Remove from Changes
                  </button>
                )}
                <button className="btn btn-primary" type="button" onClick={stageResource} disabled={harnesses.length === 0}>
                  {isStaged ? 'Update Changes' : 'Add to Changes'}
                  <i className="ph ph-arrow-up-right" aria-hidden="true"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
