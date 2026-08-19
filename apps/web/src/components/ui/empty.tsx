import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

export function Empty({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center', className)} {...props} />;
}

export function EmptyHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex max-w-sm flex-col items-center gap-2', className)} {...props} />;
}

export function EmptyMedia({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('mb-1 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground', className)} {...props} />;
}

export function EmptyTitle({ className, ...props }: ComponentProps<'h3'>) {
  return <h3 className={cn('font-semibold', className)} {...props} />;
}

export function EmptyDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export function EmptyContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('mt-4 flex items-center justify-center gap-2', className)} {...props} />;
}
