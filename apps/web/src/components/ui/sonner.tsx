import type { ComponentProps } from 'react';
import { Toaster as Sonner } from 'sonner';
import { CheckCircle } from '@phosphor-icons/react/dist/csr/CheckCircle';
import { Info } from '@phosphor-icons/react/dist/csr/Info';
import { Warning } from '@phosphor-icons/react/dist/csr/Warning';
import { XCircle } from '@phosphor-icons/react/dist/csr/XCircle';

function Toaster() {
  return (
    <Sonner
      className="toaster group"
      icons={{
        success: <CheckCircle className="size-4" />,
        info: <Info className="size-4" />,
        warning: <Warning className="size-4" />,
        error: <XCircle className="size-4" />,
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
