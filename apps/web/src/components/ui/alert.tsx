import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export function Alert({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('relative w-full rounded-lg border p-4 text-sm', className)} role="alert" {...props} />;
}

export function AlertTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h5 className={cn('mb-1 font-medium leading-none tracking-tight', className)} {...props} />;
}

export function AlertDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <div className={cn('text-sm [&_p]:leading-relaxed', className)} {...props} />;
}
