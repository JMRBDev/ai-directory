import * as Dialog from '@radix-ui/react-dialog';
import type { ComponentProps, ReactNode } from 'react';
import { X } from '@phosphor-icons/react/dist/csr/X';
import { cn } from '../../lib/utils';

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;

export function SheetContent({ className, side = 'right', children, ...props }: ComponentProps<typeof Dialog.Content> & { side?: 'left' | 'right'; children?: ReactNode }) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]" />
      <Dialog.Content
        className={cn(
          'fixed inset-y-0 z-50 flex w-full max-w-xl flex-col gap-4 overflow-y-auto border bg-background p-5 shadow-xl outline-none sm:p-8',
          side === 'right' ? 'right-0 border-l' : 'left-0 border-r',
          className,
        )}
        {...props}
      >
        {children}
        <Dialog.Close className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" aria-label="Close">
          <X size={18} aria-hidden="true" />
        </Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  );
}

export function SheetHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex shrink-0 flex-col gap-1.5 border-b pb-4 pr-8', className)} {...props} />;
}

export function SheetTitle({ className, ...props }: ComponentProps<typeof Dialog.Title>) {
  return <Dialog.Title className={cn('text-xl font-semibold tracking-tight', className)} {...props} />;
}

export function SheetDescription({ className, ...props }: ComponentProps<typeof Dialog.Description>) {
  return <Dialog.Description className={cn('text-sm text-muted-foreground', className)} {...props} />;
}
