import { shortenHomePath } from './types';
import type { PlanChange } from './types';

type Props = {
  changes: PlanChange[];
  showResource?: boolean;
  warnings?: string[];
  homeDir?: string | undefined;
};

const actionMeta = {
  added: { label: 'Added', className: 'badge-success badge-soft', icon: 'ph-plus' },
  modified: { label: 'Modified', className: 'badge-warning badge-soft', icon: 'ph-pencil-simple' },
  removed: { label: 'Removed', className: 'badge-error badge-soft', icon: 'ph-trash' },
} satisfies Record<PlanChange['action'], { label: string; className: string; icon: string }>;

function splitPath(path: string) {
  const index = path.lastIndexOf('/');
  return index < 0
    ? { dir: '', file: path }
    : { dir: path.slice(0, index), file: path.slice(index + 1) };
}

function warningKeys(warnings: string[]) {
  return new Set(warnings.map((warning) => warning.split('@')[0]));
}

function ChangeRow({ change, homeDir }: { change: PlanChange; homeDir?: string | undefined }) {
  const { dir, file } = splitPath(change.path);
  const meta = actionMeta[change.action];
  const content = change.after ?? change.before;
  const displayDir = shortenHomePath(dir, homeDir);
  const displayPath = shortenHomePath(change.path, homeDir);

  return (
    <li className="rounded-box border border-base-300 bg-base-200 p-3">
      <div className="flex items-center gap-3">
        <span className={'badge badge-sm shrink-0 gap-1 ' + meta.className}>
          <i className={'ph ' + meta.icon} aria-hidden="true"></i>
          {meta.label}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-xs font-semibold text-base-content" title={displayPath}>{file}</p>
          <p className="truncate font-mono text-[11px] text-base-content/50" title={displayDir}>{displayDir || '/'}</p>
        </div>
      </div>
      {content && (
        <details className="collapse collapse-arrow mt-3 border-t border-base-300">
          <summary className="collapse-title min-h-0 px-0 py-2 text-xs font-semibold text-primary">
            {change.action === 'modified' ? 'View file change' : 'View file content'}
          </summary>
          <div className="collapse-content px-0">
            <div className="mockup-code max-h-64 overflow-auto text-xs leading-5 before:hidden">
              <pre>
                <code>
                  {change.action === 'modified'
                    ? 'Before:\n' + (change.before ?? '(file did not exist)') + '\n\nAfter:\n' + (change.after ?? '(file will be removed)')
                    : content}
                </code>
              </pre>
            </div>
          </div>
        </details>
      )}
    </li>
  );
}

export default function ChangeRows({ changes, showResource = false, warnings = [], homeDir }: Props) {
  const sorted = [...changes].sort((left, right) => left.path.localeCompare(right.path));

  if (!showResource) {
    return (
      <ul className="mt-2 space-y-2" aria-label="File changes">
        {sorted.map((change) => (
          <ChangeRow key={change.action + change.path + change.harness} change={change} homeDir={homeDir} />
        ))}
      </ul>
    );
  }

  const unreviewed = warningKeys(warnings);
  const groups = new Map<string, PlanChange[]>();
  for (const change of sorted) {
    const group = groups.get(change.resource) ?? [];
    group.push(change);
    groups.set(change.resource, group);
  }
  const groupList = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));

  return (
    <div className="space-y-4">
      {groupList.map(([resource, groupChanges]) => {
        const groupId = 'group-' + resource.replace(/\//g, '-');
        return (
          <section key={resource} aria-labelledby={groupId}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 id={groupId} className="text-sm font-semibold text-base-content">{resource}</h3>
              {unreviewed.has(resource) && (
                <span className="badge badge-warning badge-soft badge-sm gap-1">
                  <i className="ph ph-warning" aria-hidden="true"></i>
                  Unreviewed
                </span>
              )}
            </div>
            <ul className="mt-2 space-y-2" aria-label={'File changes for ' + resource}>
              {groupChanges.map((change) => (
                <ChangeRow key={change.action + change.path + change.harness} change={change} homeDir={homeDir} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}