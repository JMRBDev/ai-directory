import type { ComponentChildren } from 'preact';

type Props = {
  id: string;
  title: string;
  children: ComponentChildren;
  onOpen?: () => void;
};

export default function DrawerShell({ id, title, children, onOpen }: Props) {
  const titleId = id + '-title';

  return (
    <div className="drawer drawer-end">
      <input
        className="drawer-toggle"
        id={id}
        type="checkbox"
        onChange={(event) => {
          if (event.currentTarget.checked) onOpen?.();
        }}
      />
      <div className="drawer-content pointer-events-none" aria-hidden="true"></div>
      <div className="drawer-side">
        <label className="drawer-overlay bg-neutral/30" htmlFor={id} aria-label={'Close ' + title.toLowerCase()}></label>
        <aside
          className="card card-border min-h-full w-full max-w-4xl overflow-y-auto rounded-none bg-base-100 text-base-content shadow-2xl"
          aria-labelledby={titleId}
          role="dialog"
          aria-modal="true"
        >
          <div className="card-body min-h-full overflow-y-auto p-5 sm:p-8">
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-base-300 pb-5">
              <h2 id={titleId} className="text-xl font-semibold tracking-tight text-base-content">{title}</h2>
              <label
                className="btn btn-ghost btn-square btn-sm shrink-0"
                htmlFor={id}
                aria-label={'Close ' + title.toLowerCase()}
                title={'Close ' + title.toLowerCase()}
              >
                <i className="ph ph-x text-lg" aria-hidden="true"></i>
                <span className="sr-only">Close</span>
              </label>
            </div>
            <div className="min-h-0 flex-1 pt-5">{children}</div>
          </div>
        </aside>
      </div>
    </div>
  );
}
