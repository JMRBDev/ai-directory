import ChangeRows from './ChangeRows';
import type { Action, ChangePlan } from './types';

type Props = {
  plan: ChangePlan;
  showResource?: boolean;
  homeDir?: string | undefined;
  actions?: Record<string, Action> | undefined;
  onRemove?: ((resource: string) => void) | undefined;
  force: boolean;
  onForce: (value: boolean) => void;
  status: string;
  statusError: boolean;
  busy: boolean;
  onApply: () => void;
  title?: string;
  onClose?: () => void;
};

export default function PlanView({ plan, showResource, homeDir, actions, onRemove, force, onForce, status, statusError, busy, onApply, title, onClose }: Props) {
  const removesInstallation = plan.operations?.some((operation) => operation.action === 'uninstall') ?? false;
  const canApply = (plan.changes.length > 0 || removesInstallation) && (plan.conflicts.length === 0 || force);

  return (
    <div className="card card-border mt-5 bg-base-100" data-plan>
      <div className="card-body p-5">
        {(title || onClose) && <div className="flex items-center justify-between gap-4 border-b border-base-300 pb-4"><h3 className="text-lg font-semibold tracking-tight text-base-content">{title}</h3>{onClose && <button className="btn btn-ghost btn-sm" type="button" onClick={onClose}>Close</button>}</div>}
        <div className="mt-4">
          {plan.changes.length
            ? <ChangeRows changes={plan.changes} showResource={showResource ?? false} warnings={plan.warnings} homeDir={homeDir} actions={actions} onRemove={onRemove} />
            : <div className="alert alert-info items-start text-sm"><i className="ph ph-info text-lg" aria-hidden="true" /><span>No file changes are needed. Applying this plan will update the installation record.</span></div>}
        </div>
        {plan.conflicts.length > 0 && (
          <div className="alert alert-warning mt-4 items-start text-sm" role="alert">
            <i className="ph ph-warning text-lg" aria-hidden="true" />
            <span>Review required: {plan.conflicts.join(' ')}</span>
          </div>
        )}
        {plan.conflicts.length > 0 && (
          <label className="alert alert-warning mt-4 items-start gap-3 text-sm">
            <input className="checkbox checkbox-warning mt-0.5" type="checkbox" checked={force} onChange={(event) => onForce(event.currentTarget.checked)} />
            <span><strong className="font-semibold">Allow overwrite or removal of locally changed files</strong><span className="mt-1 block text-xs">Use this only after checking the affected files.</span></span>
          </label>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          {status && (
            <div className={'alert items-start text-sm ' + (statusError ? 'alert-error' : 'alert-info')} role={statusError ? 'alert' : 'status'} aria-live="polite">
              <i className={'text-lg ' + (statusError ? 'ph ph-warning-circle' : 'ph ph-info')} aria-hidden="true" />
              <span className="whitespace-pre-line">{status}</span>
            </div>
          )}
          <button className="btn btn-primary" type="button" onClick={onApply} disabled={!canApply || busy}>Apply changes</button>
        </div>
      </div>
    </div>
  );
}
