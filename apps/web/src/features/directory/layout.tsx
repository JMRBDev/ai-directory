import { Outlet } from '@tanstack/react-router';
import { TooltipProvider } from '../../components/ui/tooltip';
import { Toaster } from '../../components/ui/sonner';
import { useDirectory } from './context';
import { DirectoryProvider } from './directory-provider';
import { ChangesSheet, InstalledSheet, PublishSheet, SettingsSheet } from './sheets';
import { SiteHeader } from './site-header';

export function RootLayout() {
  return (
    <DirectoryProvider>
      <TooltipProvider delayDuration={300}>
        <div className="flex min-h-screen flex-col bg-background text-foreground">
          <SiteHeader />
          <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:px-8">
            <Outlet />
          </main>
          <WorkspaceSheets />
          <Toaster />
        </div>
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
