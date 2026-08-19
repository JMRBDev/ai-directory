import { CaretLeft } from '@phosphor-icons/react/dist/csr/CaretLeft';
import { CaretRight } from '@phosphor-icons/react/dist/csr/CaretRight';
import { forwardRef, type ComponentProps, type HTMLAttributes, type ReactNode } from 'react';
import { Button } from './button';
import { cn } from '../../lib/utils';

export function Pagination({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <nav aria-label="pagination" className={cn('mx-auto flex w-full justify-center', className)} {...props} />;
}

export function PaginationContent({ className, ...props }: HTMLAttributes<HTMLUListElement>) {
  return <ul className={cn('flex flex-row items-center gap-1', className)} {...props} />;
}

export function PaginationItem({ className, ...props }: HTMLAttributes<HTMLLIElement>) {
  return <li className={cn('', className)} {...props} />;
}

type PaginationButtonProps = Omit<ComponentProps<typeof Button>, 'size' | 'variant'> & { children?: ReactNode };

export const PaginationPrevious = forwardRef<HTMLButtonElement, PaginationButtonProps>(({ children = 'Previous', className, ...props }, ref) => (
  <Button ref={ref} variant="outline" size="sm" className={cn('gap-1 pl-2.5', className)} {...props}>
    <CaretLeft size={16} />
    <span>{children}</span>
  </Button>
));

PaginationPrevious.displayName = 'PaginationPrevious';

export const PaginationNext = forwardRef<HTMLButtonElement, PaginationButtonProps>(({ children = 'Next', className, ...props }, ref) => (
  <Button ref={ref} variant="outline" size="sm" className={cn('gap-1 pr-2.5', className)} {...props}>
    <span>{children}</span>
    <CaretRight size={16} />
  </Button>
));

PaginationNext.displayName = 'PaginationNext';
