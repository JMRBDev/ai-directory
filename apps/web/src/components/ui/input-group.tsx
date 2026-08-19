import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

export function InputGroup({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex h-9 w-full items-center rounded-md border border-input bg-background shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50', className)} {...props} />;
}

export function InputGroupAddon({ className, align = 'inline-start', ...props }: ComponentProps<'div'> & { align?: 'inline-start' | 'inline-end' }) {
  return <div className={cn('flex shrink-0 items-center justify-center px-3 text-muted-foreground [&>svg]:size-4', align === 'inline-end' && 'order-last', className)} {...props} />;
}

export function InputGroupInput({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn('min-w-0 flex-1 bg-transparent px-3 py-1 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50', className)} {...props} />;
}
