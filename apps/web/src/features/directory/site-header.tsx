import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu';
import { Separator } from '../../components/ui/separator';
import { cn } from '../../lib/utils';
import { useDirectory } from './context';
import { TooltipIconButton } from './shared';
import { HugeiconsIcon } from '@hugeicons/react';
import { HardDriveIcon, MoreVerticalIcon, PackageIcon, PlayListAddIcon, RefreshIcon, Settings01Icon, Upload04Icon } from '@hugeicons/core-free-icons';

export function SiteHeader() {
  const { setSheet, staged, refreshRegistry } = useDirectory();
  const [refreshing, setRefreshing] = useState(false);

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

  const changeCount = Object.keys(staged).length;

  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-5 sm:px-8">
        <Button render={<Link to="/" />} variant="ghost" size="sm" className="-ml-2 font-semibold">
          <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">
            <HugeiconsIcon icon={PackageIcon} size={16} />
          </span>
          AI Directory
        </Button>
        <nav className="flex items-center gap-1" aria-label="Workspace actions">
          <div className="hidden items-center gap-1 sm:flex">
            <TooltipIconButton label="Refresh registry" onClick={() => void refresh()} disabled={refreshing}>
              <HugeiconsIcon icon={RefreshIcon} size={17} className={cn(refreshing && 'animate-spin')} />
            </TooltipIconButton>
            <TooltipIconButton label="Installed resources" onClick={() => setSheet('installed')}>
              <HugeiconsIcon icon={HardDriveIcon} size={17} />
            </TooltipIconButton>
            <TooltipIconButton label="Settings" onClick={() => setSheet('settings')}>
              <HugeiconsIcon icon={Settings01Icon} size={17} />
            </TooltipIconButton>
            <Separator orientation="vertical" className="mx-1 h-5" />
            <Button variant="outline" size="sm" onClick={() => setSheet('publish')}>
              <HugeiconsIcon icon={Upload04Icon} size={15} /> Publish
            </Button>
            <Button variant={changeCount > 0 ? 'default' : 'outline'} size="sm" onClick={() => setSheet('changes')}>
              <HugeiconsIcon icon={PlayListAddIcon} size={15} /> Changes{changeCount > 0 && <span className="tabular-nums">· {changeCount}</span>}
            </Button>
          </div>
          <div className="sm:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon" aria-label="Open workspace actions" />}
              >
                <HugeiconsIcon icon={MoreVerticalIcon} size={20} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void refresh()} disabled={refreshing}>
                  <HugeiconsIcon icon={RefreshIcon} size={16} /> Refresh registry
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setSheet('installed')}>
                  <HugeiconsIcon icon={HardDriveIcon} size={16} /> Installed resources
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setSheet('publish')}>
                  <HugeiconsIcon icon={Upload04Icon} size={16} /> Publish resource
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setSheet('changes')}>
                  <HugeiconsIcon icon={PlayListAddIcon} size={16} /> Changes{changeCount > 0 ? ` · ${changeCount}` : ''}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setSheet('settings')}>
                  <HugeiconsIcon icon={Settings01Icon} size={16} /> Settings
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </nav>
      </div>
    </header>
  );
}
