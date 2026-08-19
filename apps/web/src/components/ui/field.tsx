import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

export function Field({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('space-y-2', className)} {...props} />;
}

export function FieldGroup({ className, ...props }: ComponentProps<'fieldset'>) {
  return <fieldset className={cn('space-y-2', className)} {...props} />;
}

export function FieldLegend({ className, ...props }: ComponentProps<'legend'>) {
  return <legend className={cn('text-sm font-medium leading-none', className)} {...props} />;
}

export function FieldLabel({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('text-sm font-medium leading-none', className)} {...props} />;
}

export function FieldDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-xs text-muted-foreground', className)} {...props} />;
}

export function FieldContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('min-w-0 flex-1', className)} {...props} />;
}
