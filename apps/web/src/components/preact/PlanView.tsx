import ChangeRows from './ChangeRows';
import type { ChangePlan } from './types';

type Props = {
  plan: ChangePlan;
  showResource?: boolean;
  force: boolean;
  onForce: (value: boolean) => void;
  status: string;
  busy: boolean;
  onApply: () => void;
  title?: string;
  onClose?: () => void;
};

export default function PlanView({ plan, showResource, force, onForce, status, busy, onApply, title, onClose }: Props) {
  const count = (action: ChangePlan['changes'][number]['action']) =>
    plan.changes.filter((change) => change.action === action).length;
  const canApply = plan.changes.length > 0 && (plan.conflicts.length === 0 || force);

  return (
    <div className="card card-border mt-5 bg-base-100" data-plan>
      <div className="card-body p-5">
        {(title || onClose) && <div className="flex items-center justify-between gap-4 border-b border-base-300 pb-4"><h3 className="text-lg font-semibold tracking-tight text-base-content">{title}</h3>{onClose && <button className="btn btn-ghost btn-sm" type="button" onClick={onClose}>Close</button>}</div>}
        <div className="stats stats-vertical w-full border-y border-base-300 sm:stats-horizontal">
          {(['added', 'modified', 'removed'] as const).map((action, index) => (
            <div className={'stat px-0 py-3 ' + (index > 0 ? 'border-base-300 sm:border-l sm:px-4' : 'sm:pr-4')} key={action}>
              <div className="stat-value text-xl">{count(action)}</div>
              <div className="stat-title text-xs">{action.charAt(0).toUpperCase() + action.slice(1)}</div>
            </div>
          ))}
        </div>
        <div className="mt-4">
          {plan.changes.length
            ? <ChangeRows changes={plan.changes} showResource={showResource ?? false} />
            : <div className="alert alert-info items-start text-sm"><i className="ph ph-info text-lg" aria-hidden="true" /><span>No file changes are needed.</span></div>}
        </div>
        {plan.conflicts.length > 0 && (
          <div className="alert alert-warning mt-4 items-start text-sm" role="alert">
            <i className="ph ph-warning text-lg" aria-hidden="true" />
            <span>Review required: {plan.conflicts.join(' ')}</span>
          </div>
        )}
        {plan.warnings.length > 0 && <div className="alert alert-warning mt-4 items-start text-sm"><i className="ph ph-warning text-lg" aria-hidden="true" /><span>Unreviewed resources: {plan.warnings.join(', ')}</span></div>}
        {plan.conflicts.length > 0 && (
          <label className="alert alert-warning mt-4 items-start gap-3 text-sm">
            <input className="checkbox checkbox-warning mt-0.5" type="checkbox" checked={force} onChange={(event) => onForce(event.currentTarget.checked)} />
            <span><strong className="font-semibold">Allow overwrite or removal of locally changed files</strong><span className="mt-1 block text-xs">Use this only after checking the affected files.</span></span>
          </label>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-base-content/60" role="status">{status}</p>
          <button className="btn btn-primary" type="button" onClick={onApply} disabled={!canApply || busy}>Apply changes</button>
        </div>
      </div>
    </div>
  );
}
