import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import type { Harness, HarnessManagerStatus } from '../../lib/types';
import { useDirectory } from './context';

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

export function HarnessManagerSection() {
  const { harnessDetection } = useDirectory();
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

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">Agent harnesses</h3>
      {harnessDetection === undefined && (
        <p className="text-xs text-muted-foreground">Scanning installed harnesses…</p>
      )}
      {harnessDetection?.map((harness) => (
        <div key={harness.harness} className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{harness.displayName}</p>
            <p className="truncate font-mono text-xs text-muted-foreground">
              {harness.installed ? (harness.version ? `v${harness.version}` : 'installed') : 'not installed'}
            </p>
          </div>
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
      ))}
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
