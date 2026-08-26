import { useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Field, FieldLabel } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Separator } from '../../components/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '../../components/ui/toggle-group';
import { api } from '../../lib/api';
import type { InstallScope } from '../../lib/types';
import { ErrorMessage, SheetFrame } from './common';
import { HarnessManagerSection } from './harness-manager';
import { badgeTone } from './shared';
import { installScope } from './model';
import { getServerSystemTheme, getSystemTheme, readStorage, subscribeSystemTheme, writeStorage } from '../../lib/theme';

export function SettingsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const config = useQuery({ queryKey: ['config'], queryFn: api.config, enabled: open });
  const [repository, setRepository] = useState<string | undefined>(undefined);
  const [configScope, setConfigScope] = useState<InstallScope>('user');
  const [theme, setTheme] = useState(() => readStorage<'light' | 'dark' | 'system'>('ai-directory-theme', 'system'));
  const systemDark = useSyncExternalStore(subscribeSystemTheme, getSystemTheme, getServerSystemTheme);
  const currentRepository = config.data?.repository ?? '';
  const configError = config.error instanceof Error ? config.error.message : config.error ? 'Could not load the registry configuration.' : undefined;
  const rawSource = config.data?.source;
  const sourceLabel = config.isPending
    ? 'Loading'
    : configError
      ? 'Unavailable'
      : rawSource === 'user'
        ? 'User config'
        : rawSource === 'project'
          ? 'Project config'
          : rawSource && rawSource !== 'none'
            ? rawSource
            : 'Not configured';
  const saveMutation = useMutation({
    mutationFn: () => api.configPut(repository ?? currentRepository, configScope),
    onSuccess: (result) => {
      toast.success(result.source !== result.savedScope ? `Saved in the ${result.savedScope ?? configScope} config. The ${result.source} setting is still active.` : `Saved in the ${result.savedScope ?? configScope} config.`);
      void queryClient.invalidateQueries({ queryKey: ['config'] });
      void queryClient.invalidateQueries({ queryKey: ['registry'] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not save the registry source.'),
  });
  const clearMutation = useMutation({
    mutationFn: () => api.configDelete(configScope),
    onSuccess: (result) => {
      setRepository(undefined);
      toast.success(result.source !== 'none' && result.source !== result.clearedScope ? `Cleared the ${result.clearedScope ?? configScope} config. The ${result.source} setting is still active.` : `Cleared the ${result.clearedScope ?? configScope} config.`);
      void queryClient.invalidateQueries({ queryKey: ['config'] });
      void queryClient.invalidateQueries({ queryKey: ['registry'] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not clear the registry source.'),
  });

  function chooseTheme(next: 'light' | 'dark' | 'system') {
    setTheme(next);
    writeStorage('ai-directory-theme', next);
    document.documentElement.classList.toggle('dark', next === 'dark' || (next === 'system' && systemDark));
    document.documentElement.dataset.themePreference = next;
  }

  function save() {
    if ((repository ?? currentRepository).trim()) void saveMutation.mutateAsync();
  }

  return (
    <SheetFrame open={open} onOpenChange={onOpenChange} title="Settings" description="Registry source, agent harnesses, and appearance.">
      <HarnessManagerSection />
      <Separator />
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">Registry source</h3>
          <Badge {...badgeTone(sourceLabel === 'Not configured' || sourceLabel === 'Unavailable' ? 'muted' : 'secondary')}>{sourceLabel}</Badge>
        </div>
        {configError && <ErrorMessage message={configError} />}
        <Field>
          <FieldLabel htmlFor="registry-repository">Git repository URL</FieldLabel>
          <Input id="registry-repository" placeholder="https://github.com/org/resources" value={repository ?? currentRepository} onChange={(event) => setRepository(event.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="settings-scope">Save scope</FieldLabel>
          <Select value={configScope} onValueChange={(value) => { if (value !== null) setConfigScope(installScope(value)); }}>
            <SelectTrigger id="settings-scope"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="user">User config</SelectItem><SelectItem value="project">Project config</SelectItem></SelectContent>
          </Select>
        </Field>
        <div className="flex gap-2">
          <Button size="sm" onClick={save} disabled={!(repository ?? currentRepository).trim() || saveMutation.isPending}>Save</Button>
          <Button variant="ghost" size="sm" onClick={() => void clearMutation.mutateAsync()} disabled={clearMutation.isPending}>Clear</Button>
        </div>
      </section>
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
    </SheetFrame>
  );
}
