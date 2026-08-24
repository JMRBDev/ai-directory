import type { ComponentProps } from 'react';
import { Toaster as Sonner } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { Alert02Icon, CheckmarkCircle02Icon, InfoIcon, MultiplicationSignCircleIcon } from '@hugeicons/core-free-icons';

function Toaster() {
  return (
    <Sonner
      className="toaster group"
      icons={{
        success: <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-4" />,
        info: <HugeiconsIcon icon={InfoIcon} className="size-4" />,
        warning: <HugeiconsIcon icon={Alert02Icon} className="size-4" />,
        error: <HugeiconsIcon icon={MultiplicationSignCircleIcon} className="size-4" />,
      }}
      // SAFETY: sonner accepts CSS custom properties that React's style type omits.
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as ComponentProps<'div'>['style']
      }
    />
  );
}

export { Toaster };
