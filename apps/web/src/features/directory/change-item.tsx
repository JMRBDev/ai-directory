import { HugeiconsIcon } from '@hugeicons/react';
import { Delete02Icon } from '@hugeicons/core-free-icons';
import { Badge } from '../../components/ui/badge';
import type { StagedItem } from '../../lib/types';
import { useDirectory } from './context';
import { badgeTone, HarnessToggleGroup, ScopeToggleGroup, TooltipIconButton } from './shared';

export function ChangeItem({ item, onRemove, onUpdate, disabled }: {
  item: StagedItem;
  onRemove: () => void;
  onUpdate: (item: StagedItem) => void;
  disabled: boolean;
}) {
  const { harnesses, scope } = useDirectory();
  const selected = item.harnesses.length > 0 ? item.harnesses : harnesses;

  return (
    <li className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{itemName(item.resource)}</p>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{item.resource}</p>
        </div>
        {item.action === 'uninstall' && <Badge {...badgeTone('destructive')}>Remove</Badge>}
        <TooltipIconButton label={`Remove ${itemName(item.resource)}`} onClick={onRemove}>
          <HugeiconsIcon icon={Delete02Icon} />
        </TooltipIconButton>
      </div>
      <HarnessToggleGroup
        ariaLabel={`Harnesses for ${itemName(item.resource)}`}
        value={selected}
        onValueChange={(harnesses) => onUpdate({ ...item, harnesses })}
        disabled={disabled}
      />
      {item.type === 'mcp-servers' && (
        <ScopeToggleGroup
          ariaLabel={`Scope for ${itemName(item.resource)}`}
          value={item.scope ?? scope}
          onValueChange={(next) => onUpdate({ ...item, scope: next })}
          disabled={disabled}
        />
      )}
    </li>
  );
}

function itemName(resource: string) {
  return resource.split('/')[2] ?? resource;
}
