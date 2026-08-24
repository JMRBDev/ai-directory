import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowsClockwise } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { DotsThree } from '@phosphor-icons/react/dist/csr/DotsThree';
import { Gear } from '@phosphor-icons/react/dist/csr/Gear';
import { HardDrives } from '@phosphor-icons/react/dist/csr/HardDrives';
import { ListPlus } from '@phosphor-icons/react/dist/csr/ListPlus';
import { Package } from '@phosphor-icons/react/dist/csr/Package';
import { UploadSimple } from '@phosphor-icons/react/dist/csr/UploadSimple';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu';
import { Separator } from '../../components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { cn } from '../../lib/utils';
import { useDirectory } from './context';

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
        <Button asChild variant="ghost" size="sm" className="-ml-2 font-semibold">
          <Link to="/">
            <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Package size={16} weight="bold" />
            </span>
            AI Directory
          </Link>
        </Button>
        <nav className="flex items-center gap-1" aria-label="Workspace actions">
          <div className="hidden items-center gap-1 sm:flex">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Refresh registry" onClick={() => void refresh()} disabled={refreshing}>
                  <ArrowsClockwise size={17} className={cn(refreshing && 'animate-spin')} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh registry</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Installed resources" onClick={() => setSheet('installed')}>
                  <HardDrives size={17} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Installed resources</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Settings" onClick={() => setSheet('settings')}>
                  <Gear size={17} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Settings</TooltipContent>
            </Tooltip>
            <Separator orientation="vertical" className="mx-1 h-5" />
            <Button variant="outline" size="sm" onClick={() => setSheet('publish')}>
              <UploadSimple size={15} /> Publish
            </Button>
            <Button variant={changeCount > 0 ? 'default' : 'outline'} size="sm" onClick={() => setSheet('changes')}>
              <ListPlus size={15} /> Changes{changeCount > 0 && <span className="tabular-nums">· {changeCount}</span>}
            </Button>
          </div>
          <div className="sm:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Open workspace actions">
                  <DotsThree size={20} weight="bold" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void refresh()} disabled={refreshing}>
                  <ArrowsClockwise size={16} /> Refresh registry
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setSheet('installed')}>
                  <HardDrives size={16} /> Installed resources
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setSheet('publish')}>
                  <UploadSimple size={16} /> Publish resource
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setSheet('changes')}>
                  <ListPlus size={16} /> Changes{changeCount > 0 ? ` · ${changeCount}` : ''}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setSheet('settings')}>
                  <Gear size={16} /> Settings
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </nav>
      </div>
    </header>
  );
}
