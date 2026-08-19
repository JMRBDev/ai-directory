import { Outlet } from '@tanstack/react-router';
import { TooltipProvider } from '../../components/ui/tooltip';
import { Toaster } from '../../components/ui/sonner';
import { DirectoryProvider, useDirectory } from './context';
import { ChangesSheet, InstalledSheet, PublishSheet, SettingsSheet } from './sheets';
import { SiteHeader } from './common';

export function RootLayout() {
  return (
    <DirectoryProvider>
      <TooltipProvider delayDuration={300}>
        <div className="flex min-h-screen flex-col bg-background text-foreground">
          <SiteHeader />
          <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:px-8 sm:py-10">
            <Outlet />
          </main>
          <footer className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 border-t px-5 py-6 text-xs text-muted-foreground sm:px-8">
            <span>Backed by the production resource registry.</span>
            <span>Local-first workspace</span>
          </footer>
          <WorkspaceSheets />
        </div>
        <Toaster />
      </TooltipProvider>
    </DirectoryProvider>
  );
}

function WorkspaceSheets() {
  const { sheet, setSheet } = useDirectory();

  return (
    <>
      <ChangesSheet open={sheet === 'changes'} onOpenChange={(open) => setSheet(open ? 'changes' : null)} />
      <InstalledSheet open={sheet === 'installed'} onOpenChange={(open) => setSheet(open ? 'installed' : null)} />
      <SettingsSheet open={sheet === 'settings'} onOpenChange={(open) => setSheet(open ? 'settings' : null)} />
      <PublishSheet open={sheet === 'publish'} onOpenChange={(open) => setSheet(open ? 'publish' : null)} />
    </>
  );
}
