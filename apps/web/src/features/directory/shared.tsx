import type { ReactNode } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { PlayListAddIcon } from '@hugeicons/core-free-icons';
import { Button } from '../../components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../../components/ui/empty';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { ToggleGroup, ToggleGroupItem } from '../../components/ui/toggle-group';
import { harnessOptions, type Harness, type InstallScope } from '../../lib/types';

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
      onValueChange={onValueChange}
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
      onValueChange={(values) => { const next = values[0]; if (next) onValueChange(next); }}
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
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} onClick={onClick} disabled={disabled}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
