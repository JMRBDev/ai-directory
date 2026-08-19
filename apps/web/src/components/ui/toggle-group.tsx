import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from '../../lib/utils';

export const ToggleGroup = ToggleGroupPrimitive.Root;

export const ToggleGroupItem = forwardRef<
  ElementRef<typeof ToggleGroupPrimitive.Item>,
  ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Item
    ref={ref}
    className={cn(
      'inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-secondary data-[state=on]:text-secondary-foreground',
      className,
    )}
    {...props}
  />
));

ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName;
