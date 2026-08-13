import type { PlanChange } from './types';

type Props = {
  changes: PlanChange[];
  showResource?: boolean;
};

const groups = [
  ['added', 'Added files'],
  ['modified', 'Modified files'],
  ['removed', 'Removed files'],
] as const;

export default function ChangeRows({ changes, showResource = false }: Props) {
  return (
    <div className="space-y-6">
      {groups.map(([action, label]) => {
        const group = changes.filter((change) => change.action === action);
        if (group.length === 0) return null;

        return (
          <section key={action} aria-labelledby={'changes-' + action}>
            <h3 id={'changes-' + action} className="text-sm font-semibold text-base-content">{label}</h3>
            <ul className="list list-sm mt-3">
              {group.map((change) => {
                const content = change.after ?? change.before;
                const metadata = (showResource ? change.resource + ' · ' : '')
                  + change.harness + ' · ' + change.scope;

                return (
                  <li className="list-row list-col-wrap gap-3 bg-base-200" key={change.action + change.path + change.harness}>
                    <div className="list-col-grow">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <span className="break-all font-mono text-xs font-semibold text-base-content">{change.path}</span>
                        <span className="text-xs text-base-content/60">{metadata}</span>
                      </div>
                      {content && (
                        <details className="collapse collapse-arrow mt-3 border border-base-300">
                          <summary className="collapse-title min-h-0 py-3 text-xs font-semibold text-primary">
                            {change.action === 'modified' ? 'View file change' : 'View file content'}
                          </summary>
                          <div className="collapse-content">
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
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
