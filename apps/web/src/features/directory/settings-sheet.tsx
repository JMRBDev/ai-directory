import { useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Separator } from '../../components/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '../../components/ui/toggle-group';
import { SheetFrame } from './common';
import { HarnessManagerSection } from './harness-manager';
import { RegistryManagerSection } from './registry-manager';
import { getServerSystemTheme, getSystemTheme, readStorage, subscribeSystemTheme, writeStorage } from '../../lib/theme';

export function SettingsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  void queryClient;
  const [theme, setTheme] = useState(() => readStorage<'light' | 'dark' | 'system'>('ai-directory-theme', 'system'));
  const systemDark = useSyncExternalStore(subscribeSystemTheme, getSystemTheme, getServerSystemTheme);

  function chooseTheme(next: 'light' | 'dark' | 'system') {
    setTheme(next);
    writeStorage('ai-directory-theme', next);
    document.documentElement.classList.toggle('dark', next === 'dark' || (next === 'system' && systemDark));
    document.documentElement.dataset.themePreference = next;
  }

  return (
    <SheetFrame open={open} onOpenChange={onOpenChange} title="Settings" description="Registries, agent harnesses, and appearance.">
      <div className="flex flex-col gap-5">
        <HarnessManagerSection />
        <Separator />
        <RegistryManagerSection />
        <Separator />
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">Appearance</h3>
          <ToggleGroup
            value={[theme]}
            onValueChange={(value) => { const next = value[0]; if (next === 'system' || next === 'light' || next === 'dark') chooseTheme(next); }}
            aria-label="Color theme"
          >
            {(['system', 'light', 'dark'] as const).map((value) => (
              <ToggleGroupItem className="capitalize" value={value} key={value}>{value}</ToggleGroupItem>
            ))}
          </ToggleGroup>
        </section>
      </div>
    </SheetFrame>
  );
}
