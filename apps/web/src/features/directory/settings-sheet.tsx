import { useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Field, FieldDescription, FieldLabel } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Separator } from '../../components/ui/separator';
import { ToggleGroup, ToggleGroupItem } from '../../components/ui/toggle-group';
import { api, appVersion, healthCheck, pairSession, readLocalApi, readLocalSession, readLocalSessionId, serverHealth, writeLocalApi, writeLocalSession } from '../../lib/api';
import type { InstallScope } from '../../lib/types';
import { serverVersionStatus } from '../../lib/versions';
import { ErrorMessage, SheetFrame } from './common';
import { HarnessManagerSection, PiMcpAdapterSection } from './harness-manager';
import { badgeTone } from './shared';
import { installScope } from './model';
import { getServerSystemTheme, getSystemTheme, readStorage, subscribeSystemTheme, writeStorage } from '../../lib/theme';

const scopeOptions = [
  { value: 'user', label: 'User config' },
  { value: 'project', label: 'Project config' },
] as const;

type ConnectionStatus = 'idle' | 'checking' | 'connected' | 'unreachable';

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
  const [localUrl, setLocalUrl] = useState(() => readLocalApi());
  const [localToken, setLocalToken] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(() =>
    readLocalApi() ? 'idle' : 'idle',
  );
  const remoteSessionsQuery = useQuery({
    queryKey: ['auth-sessions'],
    queryFn: api.sessions,
    enabled: open && Boolean(readLocalApi()),
  });
  const revokeMutation = useMutation({
    mutationFn: (id: string) => api.revokeSession(id),
    onSuccess: (ok) => {
      if (ok) {
        toast.success('Revoked the remote session.');
        void queryClient.invalidateQueries({ queryKey: ['auth-sessions'] });
      } else {
        toast.error('The session could not be revoked.');
      }
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not revoke the session.'),
  });
  const serverVersionQuery = useQuery({
    queryKey: ['server-health'],
    queryFn: serverHealth,
    enabled: open && Boolean(readLocalApi()) && Boolean(readLocalSession()),
  });
  const siteVersion = appVersion();
  const skew = serverVersionQuery.data
    ? serverVersionStatus(serverVersionQuery.data.version, siteVersion)
    : 'unknown';
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

  async function testConnection() {
    if (!localUrl.trim()) {
      setConnectionStatus('idle');
      return;
    }
    setConnectionStatus('checking');
    const ok = await healthCheck();
    setConnectionStatus(ok ? 'connected' : 'unreachable');
    if (ok) toast.success('Connected to the local AI Directory server.');
    else toast.error('Could not reach the local AI Directory server.');
  }

  async function connectLocalConnection() {
    const url = localUrl.trim();
    const token = localToken.trim();
    if (!url) {
      toast.error('Enter the local server URL printed by `aid web`.');
      return;
    }
    if (!token) {
      toast.error('Enter the pairing token printed by `aid web`.');
      return;
    }
    try {
      writeLocalApi(url);
      const paired = await pairSession(token);
      writeLocalSession(paired.sessionToken, paired.session.id);
      setLocalToken('');
      setConnectionStatus('connected');
      toast.success('Connected. Your requests now use the local server.');
      void queryClient.invalidateQueries();
      void queryClient.invalidateQueries({ queryKey: ['auth-sessions'] });
    } catch (caught) {
      writeLocalApi('');
      writeLocalSession('');
      setConnectionStatus('unreachable');
      toast.error(caught instanceof Error ? caught.message : 'Could not pair with the local server.');
    }
  }

  function clearLocalConnection() {
    setLocalUrl('');
    setLocalToken('');
    writeLocalApi('');
    writeLocalSession('');
    setConnectionStatus('idle');
    toast.success('Cleared the local connection.');
    void queryClient.invalidateQueries();
  }

  const hasSession = Boolean(readLocalSession());
  const connectionLabel = connectionStatus === 'connected'
    ? 'Connected'
    : connectionStatus === 'unreachable'
      ? 'Unreachable'
      : connectionStatus === 'checking'
        ? 'Checking…'
        : hasSession
          ? 'Connected'
          : readLocalApi()
            ? 'Connect required'
            : 'Not configured';

  return (
    <SheetFrame open={open} onOpenChange={onOpenChange} title="Settings" description="Registry source, agent harnesses, and appearance.">
      <div className="flex flex-col gap-5">
        <HarnessManagerSection />
        <PiMcpAdapterSection />
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
              <SelectTrigger id="settings-scope"><SelectValue>{scopeOptions.find((option) => option.value === configScope)?.label}</SelectValue></SelectTrigger>
              <SelectContent>{scopeOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={!(repository ?? currentRepository).trim() || saveMutation.isPending}>Save</Button>
            <Button variant="ghost" size="sm" onClick={() => void clearMutation.mutateAsync()} disabled={clearMutation.isPending}>Clear</Button>
          </div>
        </section>
        <Separator />
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium">Local connection</h3>
            <Badge {...badgeTone(connectionStatus === 'connected' ? 'success' : connectionStatus === 'unreachable' ? 'destructive' : connectionStatus === 'checking' ? 'secondary' : 'muted')}>{connectionLabel}</Badge>
          </div>
          <FieldDescription>Run `aid web` in a terminal, then enter its URL and pairing token to control this setup from a hosted website. The pairing token is exchanged once for a session.</FieldDescription>
          <Field>
            <FieldLabel htmlFor="local-url">Local server URL</FieldLabel>
            <Input id="local-url" type="text" inputMode="url" placeholder="http://127.0.0.1:4321" value={localUrl} onChange={(event) => { setLocalUrl(event.target.value); setConnectionStatus('idle'); }} autoComplete="off" />
          </Field>
          <Field>
            <FieldLabel htmlFor="local-token">Pairing token</FieldLabel>
            <Input id="local-token" type="password" placeholder="Paste the token printed by aid web" value={localToken} onChange={(event) => setLocalToken(event.target.value)} autoComplete="off" />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void testConnection()} disabled={connectionStatus === 'checking' || !localUrl.trim()}>Test connection</Button>
            <Button size="sm" onClick={() => void connectLocalConnection()}>Connect</Button>
            <Button variant="ghost" size="sm" onClick={clearLocalConnection} disabled={!readLocalApi() && !readLocalSession()}>Clear</Button>
          </div>
          {skew !== 'unknown' && (
            <dl className="flex flex-col gap-1 text-xs text-muted-foreground">
              <div className="flex justify-between gap-3"><dt>This website</dt><dd className="tabular-nums">v{siteVersion}</dd></div>
              <div className="flex justify-between gap-3"><dt>Local server</dt><dd className="tabular-nums">{serverVersionQuery.data?.version ? `v${serverVersionQuery.data.version}` : 'unknown'}</dd></div>
            </dl>
          )}
          {skew === 'server-behind' && (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600">
              The local server is older than this website. Restart it from a newer `aid` build to avoid mismatches.
            </p>
          )}
          {hasSession && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-muted-foreground">Remote sessions</p>
              {remoteSessionsQuery.isPending ? (
                <p className="text-xs text-muted-foreground" role="status">Loading…</p>
              ) : remoteSessionsQuery.error ? (
                <ErrorMessage message={remoteSessionsQuery.error instanceof Error ? remoteSessionsQuery.error.message : 'Could not load remote sessions.'} />
              ) : (remoteSessionsQuery.data?.length ?? 0) === 0 ? (
                <p className="text-xs text-muted-foreground">No remote sessions. Connect from a hosted website to create one.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {remoteSessionsQuery.data?.map((session) => (
                    <li key={session.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm">{session.label}</span>
                        <span className="text-xs text-muted-foreground">Created {new Date(session.createdAt).toLocaleString()}{readLocalSessionId() === session.id ? ' · this browser' : ''}</span>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => void revokeMutation.mutateAsync(session.id)} disabled={revokeMutation.isPending}>
                        Revoke
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
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
      </div>
    </SheetFrame>
  );
}
