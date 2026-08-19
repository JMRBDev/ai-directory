import { useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Field, FieldLabel } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Separator } from '../../components/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '../../components/ui/toggle-group';
import { api } from '../../lib/api';
import { harnessOptions, type InstallScope } from '../../lib/types';
import { SheetFrame } from './common';
import { useDirectory } from './context';
import { getServerSystemTheme, getSystemTheme, installScope, readStorage, subscribeSystemTheme, writeStorage } from './model';

export function SettingsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { harnesses, setHarnesses } = useDirectory();
  const queryClient = useQueryClient();
  const config = useQuery({ queryKey: ['config'], queryFn: api.config, enabled: open });
  const [repository, setRepository] = useState<string | undefined>(undefined);
  const [configScope, setConfigScope] = useState<InstallScope>('user');
  const [theme, setTheme] = useState(() => readStorage<'light' | 'dark' | 'system'>('ai-directory-theme', 'system'));
  const systemDark = useSyncExternalStore(subscribeSystemTheme, getSystemTheme, getServerSystemTheme);
  const currentRepository = config.data?.repository ?? '';
  const sourceLabel = config.data?.source === 'none' ? 'Not configured' : config.data?.source ?? 'Loading';
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
    <SheetFrame open={open} onOpenChange={onOpenChange} title="Settings" description="Set the registry source, default harnesses, and appearance.">
      <div className="space-y-7 py-6">
        <section>
          <h3 className="font-medium">Default harnesses</h3>
          <p className="mt-1 text-sm text-muted-foreground">New staged resources use these harnesses.</p>
          <div className="mt-3 space-y-2">{harnessOptions.map((option) => <Label className="flex items-center gap-3 text-sm" htmlFor={`settings-harness-${option.value}`} key={option.value}><Checkbox id={`settings-harness-${option.value}`} checked={harnesses.includes(option.value)} onCheckedChange={(checked) => setHarnesses(checked === true ? [...harnesses, option.value] : harnesses.filter((item) => item !== option.value))} />{option.label}</Label>)}</div>
        </section>
        <Separator />
        <section>
          <div className="flex items-center justify-between gap-3"><h3 className="font-medium">Registry source</h3><Badge variant={sourceLabel === 'Not configured' ? 'muted' : 'outline'}>{sourceLabel}</Badge></div>
          <p className="mt-1 text-sm text-muted-foreground">The repository setting is stored by the local API.</p>
          <Field className="mt-4"><FieldLabel htmlFor="registry-repository">Git repository URL</FieldLabel><Input id="registry-repository" placeholder="https://github.com/org/resources" value={repository ?? currentRepository} onChange={(event) => setRepository(event.target.value)} /></Field>
          <Field className="mt-3"><FieldLabel htmlFor="settings-scope">Save scope</FieldLabel><Select value={configScope} onValueChange={(value) => setConfigScope(installScope(value))}><SelectTrigger id="settings-scope" className="mt-2"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="user">User config</SelectItem><SelectItem value="project">Project config</SelectItem></SelectContent></Select></Field>
          <div className="mt-4 flex gap-2"><Button onClick={save} disabled={!(repository ?? currentRepository).trim() || saveMutation.isPending}>Save source</Button><Button variant="ghost" onClick={() => void clearMutation.mutateAsync()} disabled={clearMutation.isPending}>Clear</Button></div>
        </section>
        <Separator />
        <section>
          <h3 className="font-medium">Appearance</h3>
          <ToggleGroup className="mt-3 grid grid-cols-3 rounded-md border bg-muted p-1" type="single" value={theme} onValueChange={(value) => { if (value === 'system' || value === 'light' || value === 'dark') chooseTheme(value); }} aria-label="Color theme">
            {(['system', 'light', 'dark'] as const).map((value) => <ToggleGroupItem key={value} value={value}>{value.slice(0, 1).toUpperCase() + value.slice(1)}</ToggleGroupItem>)}
          </ToggleGroup>
        </section>
      </div>
    </SheetFrame>
  );
}
