import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu';
import { cn } from '../../lib/utils';
import { useDirectory } from './context';
import { TooltipIconButton } from './shared';
import { HugeiconsIcon } from '@hugeicons/react';
import { Download01Icon, HardDriveIcon, MoreVerticalIcon, PackageIcon, RefreshIcon, Settings01Icon } from '@hugeicons/core-free-icons';

export function SiteHeader() {
  const { setSheet, refreshRegistry, selection, installations } = useDirectory();
  const [refreshing, setRefreshing] = useState(false);
  const installedIds = new Set(installations.map((item) => item.resource));
  const pendingCount = selection.filter((entry) => !installedIds.has(entry.id)).length;

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refreshRegistry();
      toast.success('Registry refreshed.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not refresh the registry.');
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-5 sm:px-8">
        <Button render={<Link to="/" />} variant="ghost" size="sm" className="-ml-2 font-semibold">
          <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">
            <HugeiconsIcon icon={PackageIcon} />
          </span>
          AI Directory
        </Button>
        <nav className="flex items-center gap-1" aria-label="Workspace actions">
          <div className="hidden items-center gap-1 sm:flex">
            <TooltipIconButton label="Refresh registry" onClick={() => void refresh()} disabled={refreshing}>
              <HugeiconsIcon icon={RefreshIcon} className={cn(refreshing && 'animate-spin')} />
            </TooltipIconButton>
            <TooltipIconButton label="Installed resources" onClick={() => setSheet('installed')}>
              <HugeiconsIcon icon={HardDriveIcon} />
            </TooltipIconButton>
            <Button variant="ghost" size="sm" className="relative" onClick={() => setSheet('batch')} aria-label={pendingCount > 0 ? `Batch install, ${pendingCount} selected` : 'Batch install'}>
              <HugeiconsIcon icon={Download01Icon} />
              Batch
              {pendingCount > 0 && (
                <Badge variant="default" className="ml-1 tabular-nums">{pendingCount}</Badge>
              )}
            </Button>
            <TooltipIconButton label="Settings" onClick={() => setSheet('settings')}>
              <HugeiconsIcon icon={Settings01Icon} />
            </TooltipIconButton>
          </div>
          <div className="sm:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon" aria-label="Open workspace actions" />}
              >
                <HugeiconsIcon icon={MoreVerticalIcon} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => void refresh()} disabled={refreshing}>
                  <HugeiconsIcon icon={RefreshIcon} /> Refresh registry
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSheet('installed')}>
                  <HugeiconsIcon icon={HardDriveIcon} /> Installed resources
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSheet('batch')}>
                  <HugeiconsIcon icon={Download01Icon} /> Batch install{pendingCount > 0 ? ` (${pendingCount})` : ''}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSheet('settings')}>
                  <HugeiconsIcon icon={Settings01Icon} /> Settings
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </nav>
      </div>
    </header>
  );
}
