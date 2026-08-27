import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { FieldDescription } from '../../components/ui/field';
import { Label } from '../../components/ui/label';
import { api } from '../../lib/api';
import type { Harness, HarnessManagerStatus, HarnessOrigin } from '../../lib/types';
import { useDirectory } from './context';
import { badgeTone } from './shared';

type HarnessAction = 'install' | 'update' | 'uninstall';

const actionLabels = {
  install: 'Install',
  update: 'Update',
  uninstall: 'Uninstall',
} satisfies Record<HarnessAction, string>;

function commandFor(status: HarnessManagerStatus, action: HarnessAction): string {
  return action === 'install'
    ? status.installCommand
    : action === 'update'
      ? status.upgradeCommand
      : status.uninstallCommand;
}

const originLabels = {
  npm: 'via npm',
  homebrew: 'via Homebrew',
  native: 'native install',
} satisfies Record<HarnessOrigin, string>;

function statusLine(harness: HarnessManagerStatus): string {
  if (!harness.installed) return 'not installed';
  const version = harness.version ? `v${harness.version}` : 'installed';
  return harness.origin ? `${version} · ${originLabels[harness.origin]}` : version;
}

export function HarnessManagerSection() {
  const { harnessDetection, harnesses, setHarnesses } = useDirectory();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState<{ harness: HarnessManagerStatus; action: HarnessAction } | null>(null);

  const mutation = useMutation({
    mutationFn: (input: { action: HarnessAction; harness: Harness }) => api.harnessAction(input.action, input.harness),
    onSuccess: (result, input) => {
      toast.success(`${actionLabels[input.action]}ed ${input.harness}${result.result.version ? ` ${result.result.version}` : ''}.`);
      setConfirm(null);
      void queryClient.invalidateQueries({ queryKey: ['harness-detection'] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'The harness action failed.'),
  });

  function toggleDefault(harness: Harness, checked: boolean) {
    const next = checked
      ? [...harnesses, harness]
      : harnesses.filter((item) => item !== harness);
    setHarnesses(next);
  }

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">Agent harnesses</h3>
      {harnessDetection === undefined && (
        <p className="text-xs text-muted-foreground">Scanning installed harnesses…</p>
      )}
      {harnessDetection?.map((harness) => {
        const isDefault = harnesses.includes(harness.harness);
        return (
          <div key={harness.harness} className="flex items-center justify-between gap-3">
            <Label htmlFor={`harness-default-${harness.harness}`} className="min-w-0 items-start gap-2.5">
              <Checkbox
                id={`harness-default-${harness.harness}`}
                className="mt-0.5"
                checked={isDefault}
                onCheckedChange={(checked) => toggleDefault(harness.harness, checked === true)}
              />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{harness.displayName}</span>
                <span className="block truncate font-mono text-xs font-normal text-muted-foreground">
                  {statusLine(harness)}
                </span>
              </span>
            </Label>
            <div className="flex shrink-0 gap-2">
              {!harness.installed && (
                <Button size="sm" onClick={() => setConfirm({ harness, action: 'install' })}>Install</Button>
              )}
              {harness.installed && (
                <>
                  <Button size="sm" variant="outline" onClick={() => setConfirm({ harness, action: 'update' })}>Update</Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirm({ harness, action: 'uninstall' })}>Uninstall</Button>
                </>
              )}
            </div>
          </div>
        );
      })}
      <FieldDescription>New staged resources use the checked harnesses.</FieldDescription>
      <AlertDialog open={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm ? `${actionLabels[confirm.action]} ${confirm.harness.displayName}?` : ''}</AlertDialogTitle>
            <AlertDialogDescription>
              Runs <code className="font-mono">{confirm ? commandFor(confirm.harness, confirm.action) : ''}</code> on this machine.
              {confirm?.action === 'uninstall' && ` Your ${confirm.harness.command} configuration directory stays in place.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={mutation.isPending}
              onClick={() => { if (confirm) void mutation.mutateAsync({ action: confirm.action, harness: confirm.harness.harness }); }}
            >
              {mutation.isPending ? 'Running…' : confirm ? actionLabels[confirm.action] : 'Run'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

export function PiMcpAdapterSection() {
  const queryClient = useQueryClient();
  const adapter = useQuery({ queryKey: ['pi-mcp-adapter'], queryFn: api.piMcpAdapter });
  const mutation = useMutation({
    mutationFn: (action: 'install' | 'uninstall') => api.piMcpAdapterAction(action),
    onSuccess: (result, action) => {
      toast.success(action === 'install' ? 'Installed the Pi MCP adapter.' : 'Uninstalled the Pi MCP adapter.');
      void queryClient.invalidateQueries({ queryKey: ['pi-mcp-adapter'] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'The Pi MCP adapter action failed.'),
  });

  const installed = adapter.data?.adapter.installed;
  const version = adapter.data?.adapter.version;
  const status = adapter.isPending
    ? 'Loading'
    : installed
      ? version
        ? `Installed · v${version}`
        : 'Installed'
      : 'Not installed';

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">Pi MCP adapter</h3>
        <Badge {...badgeTone(installed ? 'success' : 'muted')}>{status}</Badge>
      </div>
      <FieldDescription>
        Pi has no built-in MCP support. The community <code className="font-mono">pi-mcp-adapter</code> extension adds it; AI Directory writes MCP servers to <code className="font-mono">~/.pi/agent/mcp.json</code> and project <code className="font-mono">.mcp.json</code> when it is installed.
      </FieldDescription>
      {adapter.error && <FieldDescription>Could not read the Pi MCP adapter status.</FieldDescription>}
      <div className="flex gap-2">
        {!installed && (
          <Button size="sm" onClick={() => void mutation.mutateAsync('install')} disabled={mutation.isPending}>
            {mutation.isPending ? 'Installing…' : 'Install adapter'}
          </Button>
        )}
        {installed && (
          <Button size="sm" variant="ghost" onClick={() => void mutation.mutateAsync('uninstall')} disabled={mutation.isPending}>
            {mutation.isPending ? 'Removing…' : 'Remove adapter'}
          </Button>
        )}
      </div>
    </section>
  );
}
