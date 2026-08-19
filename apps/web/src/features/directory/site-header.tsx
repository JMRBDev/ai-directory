import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowsClockwise } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { DotsThree } from '@phosphor-icons/react/dist/csr/DotsThree';
import { Gear } from '@phosphor-icons/react/dist/csr/Gear';
import { ListDashes } from '@phosphor-icons/react/dist/csr/ListDashes';
import { Package } from '@phosphor-icons/react/dist/csr/Package';
import { UploadSimple } from '@phosphor-icons/react/dist/csr/UploadSimple';
import { Button } from '../../components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { cn } from '../../lib/utils';
import { useDirectory } from './context';

export function SiteHeader() {
  const { setSheet, staged, refreshRegistry } = useDirectory();
  const navigate = useNavigate();
  const [refreshing, setRefreshing] = useState(false);

  function refresh() {
    setRefreshing(true);
    refreshRegistry();
    window.setTimeout(() => setRefreshing(false), 500);
  }

  const changeCount = Object.keys(staged).length;

  return (
    <header className="sticky top-0 z-30 border-b border-border/80 bg-background/90 backdrop-blur">
      <div className="mx-auto flex min-h-16 w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <Button className="h-auto gap-3 p-0 text-left hover:bg-transparent hover:text-foreground" variant="ghost" type="button" onClick={() => void navigate({ to: '/' })}>
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Package size={20} weight="bold" /></span>
          <span>
            <span className="block font-semibold tracking-tight">AI Directory</span>
            <span className="hidden text-xs text-muted-foreground sm:block">Reusable development resources</span>
          </span>
        </Button>
        <nav className="flex items-center gap-1" aria-label="Workspace actions">
          <div className="hidden items-center gap-1 sm:flex">
            <Tooltip>
              <TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label="Refresh registry" onClick={refresh}><ArrowsClockwise className={cn(refreshing && 'animate-spin')} size={18} /></Button></TooltipTrigger>
              <TooltipContent>Refresh registry</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label="Installed resources" onClick={() => setSheet('installed')}><ListDashes size={18} /></Button></TooltipTrigger>
              <TooltipContent>Installed resources</TooltipContent>
            </Tooltip>
            <Button variant="outline" size="sm" onClick={() => setSheet('publish')}><UploadSimple size={16} /> Publish</Button>
            <Button variant={changeCount > 0 ? 'default' : 'outline'} size="sm" onClick={() => setSheet('changes')}><ListDashes size={16} /> Changes{changeCount > 0 ? ` (${changeCount})` : ''}</Button>
            <Tooltip>
              <TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label="Settings" onClick={() => setSheet('settings')}><Gear size={18} /></Button></TooltipTrigger>
              <TooltipContent>Settings</TooltipContent>
            </Tooltip>
          </div>
          <div className="sm:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Open workspace actions"><DotsThree size={22} /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={refresh}><ArrowsClockwise size={16} /> Refresh registry</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setSheet('installed')}><ListDashes size={16} /> Installed resources</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setSheet('publish')}><UploadSimple size={16} /> Publish resource</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setSheet('changes')}><ListDashes size={16} /> Changes{changeCount > 0 ? ` (${changeCount})` : ''}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setSheet('settings')}><Gear size={16} /> Settings</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </nav>
      </div>
    </header>
  );
}
