import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { createContext, useContext, forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from '../../lib/utils';

const ToggleGroupContext = createContext<{ segmented?: boolean }>({});

export const ToggleGroup = forwardRef<
  ElementRef<typeof ToggleGroupPrimitive.Root>,
  ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root> & { segmented?: boolean }
>(({ className, segmented = false, children, ...props }, ref) => (
  <ToggleGroupContext.Provider value={{ segmented }}>
    <ToggleGroupPrimitive.Root
      ref={ref}
      className={cn('flex w-full', segmented && 'h-9 items-stretch gap-1 rounded-md border bg-muted p-1', className)}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Root>
  </ToggleGroupContext.Provider>
));

ToggleGroup.displayName = 'ToggleGroup';

export const ToggleGroupItem = forwardRef<
  ElementRef<typeof ToggleGroupPrimitive.Item>,
  ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>
>(({ className, ...props }, ref) => {
  const { segmented } = useContext(ToggleGroupContext);
  return (
    <ToggleGroupPrimitive.Item
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50',
        segmented
          ? 'min-w-0 flex-1 px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm'
          : 'h-9 shrink-0 rounded-md px-3 text-sm hover:bg-muted hover:text-foreground data-[state=on]:bg-secondary data-[state=on]:text-secondary-foreground',
        className,
      )}
      {...props}
    />
  );
});

ToggleGroupItem.displayName = 'ToggleGroupItem';
