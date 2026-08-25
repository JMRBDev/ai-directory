import type { ComponentProps, ReactNode } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { PlayListAddIcon } from '@hugeicons/core-free-icons';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../../components/ui/empty';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { ToggleGroup, ToggleGroupItem } from '../../components/ui/toggle-group';
import { harnessOptions, type Harness, type InstallScope } from '../../lib/types';
import { installScope } from './model';

type StockBadgeVariant = NonNullable<ComponentProps<typeof Badge>['variant']>;
export type BadgeTone = StockBadgeVariant | 'muted' | 'success' | 'warning';

const customToneClasses = {
  muted: 'border-transparent bg-muted text-muted-foreground',
  success: 'border-transparent bg-primary/10 text-primary dark:bg-primary/20',
  warning: 'border-transparent bg-amber-500/15 text-amber-800 dark:text-amber-300',
} satisfies Record<string, string>;

export function badgeTone(tone: BadgeTone): ComponentProps<typeof Badge> {
  switch (tone) {
    case 'muted':
    case 'success':
    case 'warning':
      return { variant: 'outline', className: customToneClasses[tone] };
    default:
      return { variant: tone };
  }
}

// Base UI toggle groups emit raw string values; convert them back to domain types here
// so every consumer can stay fully typed.
function toHarnesses(values: string[]): Harness[] {
  return values.flatMap((value) => {
    const match = harnessOptions.find((option) => option.value === value);
    return match ? [match.value] : [];
  });
}

export function HarnessToggleGroup({ value, onValueChange, disabled, ariaLabel = 'Target harnesses' }: {
  value: Harness[];
  onValueChange: (harnesses: Harness[]) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <ToggleGroup
      multiple
      value={value}
      onValueChange={(values) => onValueChange(toHarnesses(values))}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      {harnessOptions.map((option) => (
        <ToggleGroupItem value={option.value} key={option.value}>{option.label}</ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function ScopeToggleGroup({ value, onValueChange, disabled, ariaLabel = 'Installation scope' }: {
  value: InstallScope;
  onValueChange: (scope: InstallScope) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={(values) => { const next = values[0]; if (next) onValueChange(installScope(next)); }}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      <ToggleGroupItem value="user">User scope</ToggleGroupItem>
      <ToggleGroupItem value="project">Project scope</ToggleGroupItem>
    </ToggleGroup>
  );
}

export function DirectoryEmpty({ icon, title, description, className }: {
  icon: ReactNode;
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <Empty className={className}>
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function NoResourcesEmpty() {
  return (
    <DirectoryEmpty
      icon={<HugeiconsIcon icon={PlayListAddIcon} />}
      title="No active resources yet"
      description="Publish the first resource, then refresh the registry."
    />
  );
}

export function TooltipIconButton({ label, onClick, disabled, children }: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="icon" aria-label={label} onClick={onClick} disabled={disabled} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
