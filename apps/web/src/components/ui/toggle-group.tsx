import { createContext, useContext, type ComponentProps, type ReactNode } from 'react';
import { Toggle as TogglePrimitive } from '@base-ui/react/toggle';
import { ToggleGroup as ToggleGroupPrimitive } from '@base-ui/react/toggle-group';
import { type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';
import { toggleVariants } from './toggle';

type ToggleVariantProps = VariantProps<typeof toggleVariants>;

const ToggleGroupContext = createContext<{
  variant?: ToggleVariantProps['variant'];
  size?: ToggleVariantProps['size'];
  spacing?: number;
  orientation?: 'horizontal' | 'vertical';
}>({
  variant: 'default',
  size: 'default',
  spacing: 2,
  orientation: 'horizontal',
});

function ToggleGroup({
  className,
  variant,
  size,
  spacing = 2,
  orientation = 'horizontal',
  children,
  ...props
}: ComponentProps<typeof ToggleGroupPrimitive> & {
  variant?: ToggleVariantProps['variant'];
  size?: ToggleVariantProps['size'];
  spacing?: number;
  orientation?: 'horizontal' | 'vertical';
  children?: ReactNode;
}) {
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      data-spacing={spacing}
      data-orientation={orientation}
      className={cn(
        'group/toggle-group flex w-fit flex-row items-center gap-2 rounded-md data-vertical:flex-col data-vertical:items-stretch',
        className,
      )}
      {...props}
    >
      <ToggleGroupContext.Provider value={{ variant, size, spacing, orientation }}>{children}</ToggleGroupContext.Provider>
    </ToggleGroupPrimitive>
  );
}

function ToggleGroupItem({
  className,
  children,
  variant = 'default',
  size = 'default',
  ...props
}: ComponentProps<typeof TogglePrimitive> & ToggleVariantProps) {
  const context = useContext(ToggleGroupContext);

  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      data-variant={context.variant || variant}
      data-size={context.size || size}
      data-spacing={context.spacing}
      className={cn(
        "shrink-0 group-data-[spacing=0]/toggle-group:rounded-none group-data-[spacing=0]/toggle-group:px-2 focus:z-10 focus-visible:z-10 group-data-horizontal/toggle-group:first:rounded-l-md group-data-vertical/toggle-group:first:rounded-t-md group-data-horizontal/toggle-group:last:rounded-r-md group-data-vertical/toggle-group:last:rounded-b-md",
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        className,
      )}
      {...props}
    >
      {children}
    </TogglePrimitive>
  );
}

export { ToggleGroup, ToggleGroupItem };
