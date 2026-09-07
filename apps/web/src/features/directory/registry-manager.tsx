import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '../../components/ui/button';
import { Field, FieldLabel } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { api, type RegistryInput } from '../../lib/api';
import type { InstallScope } from '../../lib/types';
import { ErrorMessage } from './common';
import { installScope } from './model';

const scopeOptions = [
  { value: 'user', label: 'User config' },
  { value: 'project', label: 'Project config' },
] as const;

function slugifyId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function RegistryManagerSection() {
  const queryClient = useQueryClient();
  const registries = useQuery({ queryKey: ['registries'], queryFn: api.registries });
  const [id, setId] = useState('');
  const [url, setUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [scope, setScope] = useState<InstallScope>('user');
  const [removing, setRemoving] = useState<string | null>(null);
  const entries = registries.data?.registries ?? [];

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['registries'] });
    void queryClient.invalidateQueries({ queryKey: ['config'] });
    void queryClient.invalidateQueries({ queryKey: ['registry'] });
    void queryClient.invalidateQueries({ queryKey: ['local-resources'] });
  }

  const addMutation = useMutation({
    mutationFn: () => {
      const body: RegistryInput = { id: slugifyId(id) || id.trim(), url: url.trim(), scope };
      if (branch.trim()) body.branch = branch.trim();
      return api.registryAdd(body);
    },
    onSuccess: () => {
      toast.success(`Added registry ${slugifyId(id) || id.trim()}.`);
      setId('');
      setUrl('');
      setBranch('');
      refresh();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not add the registry.'),
  });

  async function remove(entryId: string) {
    if (removing) return;
    setRemoving(entryId);
    try {
      await api.registryRemove(entryId);
      toast.success(`Removed registry ${entryId}.`);
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not remove the registry.');
    } finally {
      setRemoving(null);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">Registries</h3>
        {registries.isFetching && <span className="text-xs text-muted-foreground">Loading…</span>}
      </div>
      <p className="text-xs text-muted-foreground">
        Order is priority. The first registry wins when two registries carry the same resource.
      </p>
      {registries.error && (
        <ErrorMessage message={registries.error instanceof Error ? registries.error.message : 'Could not load registries.'} />
      )}
      {entries.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {entries.map((entry, index) => (
            <li key={`${entry.scope}:${entry.id}`} className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1.5">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs" title={entry.url}>
                  {index === 0 ? '★ ' : ''}{entry.id}
                </p>
                <p className="truncate text-[11px] text-muted-foreground" title={entry.url}>
                  {entry.scope} · {entry.url}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void remove(entry.id)}
                disabled={removing === entry.id}
                aria-label={`Remove registry ${entry.id}`}
              >
                {removing === entry.id ? 'Removing…' : 'Remove'}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        !registries.isFetching && (
          <p className="text-xs text-muted-foreground">No registries configured yet. Add the first one below.</p>
        )
      )}
      <Field>
        <FieldLabel htmlFor="registry-id">Registry id</FieldLabel>
        <Input id="registry-id" placeholder="company" value={id} onChange={(event) => setId(event.target.value)} />
      </Field>
      <Field>
        <FieldLabel htmlFor="registry-url">Git repository URL</FieldLabel>
        <Input id="registry-url" placeholder="https://github.com/org/resources" value={url} onChange={(event) => setUrl(event.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field>
          <FieldLabel htmlFor="registry-branch">Branch (optional)</FieldLabel>
          <Input id="registry-branch" placeholder="main" value={branch} onChange={(event) => setBranch(event.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="registry-scope">Save scope</FieldLabel>
          <Select value={scope} onValueChange={(value) => { if (value !== null) setScope(installScope(value)); }}>
            <SelectTrigger id="registry-scope" className="w-full"><SelectValue>{scopeOptions.find((option) => option.value === scope)?.label}</SelectValue></SelectTrigger>
            <SelectContent>{scopeOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      </div>
      <div>
        <Button
          size="sm"
          onClick={() => void addMutation.mutateAsync()}
          disabled={!id.trim() || !url.trim() || addMutation.isPending}
        >
          {addMutation.isPending ? 'Adding…' : 'Add registry'}
        </Button>
      </div>
    </section>
  );
}
