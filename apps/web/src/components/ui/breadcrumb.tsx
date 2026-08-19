import { CaretRight } from '@phosphor-icons/react/dist/csr/CaretRight';
import { Slot } from '@radix-ui/react-slot';
import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

export function Breadcrumb({ className, ...props }: ComponentProps<'nav'>) {
  return <nav aria-label="breadcrumb" className={cn('', className)} {...props} />;
}

export function BreadcrumbList({ className, ...props }: ComponentProps<'ol'>) {
  return <ol className={cn('flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground', className)} {...props} />;
}

export function BreadcrumbItem({ className, ...props }: ComponentProps<'li'>) {
  return <li className={cn('inline-flex items-center gap-1.5', className)} {...props} />;
}

export function BreadcrumbLink({ asChild, className, ...props }: ComponentProps<'a'> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'a';
  return <Comp className={cn('transition-colors hover:text-foreground', className)} {...props} />;
}

export function BreadcrumbPage({ className, ...props }: ComponentProps<'span'>) {
  return <span aria-current="page" className={cn('font-medium text-foreground', className)} {...props} />;
}

export function BreadcrumbSeparator({ className, ...props }: ComponentProps<'li'>) {
  return <li aria-hidden="true" className={cn('[&>svg]:size-3.5', className)} {...props}><CaretRight /></li>;
}
