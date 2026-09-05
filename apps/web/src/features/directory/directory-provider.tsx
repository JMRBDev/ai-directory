import { useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { harnessOptions, type Harness, type InstallScope } from '../../lib/types';
import { DirectoryContext, type BatchEntry, type DirectoryContextValue } from './context';
import { readStorage, writeStorage } from '../../lib/theme';
import type { SheetName } from './model';

export function DirectoryProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [sheet, setSheet] = useState<SheetName>(null);
  const [harnesses, setHarnessesState] = useState<Harness[]>(() => {
    const stored = readStorage<Harness[]>('ai-directory-harnesses', ['claude-code']);
    return stored.length > 0 ? stored : ['claude-code'];
  });
  const [scope, setScope] = useState<InstallScope>('user');
  const [selection, setSelection] = useState<BatchEntry[]>([]);
  // New batch entries initialize with the current global harness defaults.
  // A ref keeps the toggleSelected updater fresh without re-creating it.
  const harnessesRef = useRef(harnesses);
  harnessesRef.current = harnesses;

  function toggleSelected(id: string) {
    setSelection((current) => {
      if (current.some((entry) => entry.id === id)) {
        return current.filter((entry) => entry.id !== id);
      }
      const defaults = harnessesFor(harnessesRef.current);
      return [...current, { id, harnesses: defaults }];
    });
  }

  function setEntryHarnesses(id: string, next: Harness[]) {
    const normalized = harnessesFor(next);
    setSelection((current) => {
      // Clearing every harness on a row drops the row: an entry with no
      // harness can never install, so it must not linger.
      if (normalized.length === 0) return current.filter((entry) => entry.id !== id);
      return current.map((entry) => entry.id === id ? { ...entry, harnesses: normalized } : entry);
    });
  }

  function clearSelection() {
    setSelection([]);
  }

  const installationsQuery = useQuery({ queryKey: ['installed'], queryFn: api.installed });
  const localResourcesQuery = useQuery({ queryKey: ['local-resources'], queryFn: api.localResources });
  const harnessQuery = useQuery({ queryKey: ['harness-detection'], queryFn: api.harnesses });

  function setHarnesses(next: Harness[]) {
    const normalized = harnessesFor(next);
    if (normalized.length === 0) return;
    setHarnessesState(normalized);
    writeStorage('ai-directory-harnesses', normalized);
  }

  async function refreshRegistry() {
    await api.refresh();
    await queryClient.invalidateQueries({ queryKey: ['registry'] });
  }

  const value: DirectoryContextValue = {
    installations: installationsQuery.data?.installations ?? [],
    localResources: localResourcesQuery.data?.resources ?? [],
    localError: localResourcesQuery.error instanceof Error ? localResourcesQuery.error.message : localResourcesQuery.error ? 'Could not scan local resources.' : undefined,
    localRegistryError: localResourcesQuery.data?.registryError,
    homeDirectory: localResourcesQuery.data?.homeDirectory,
    localLoading: localResourcesQuery.isFetching,
    harnessDetection: harnessQuery.data?.harnesses,
    harnesses,
    scope,
    sheet,
    selection,
    setSheet,
    setHarnesses,
    setScope,
    toggleSelected,
    setEntryHarnesses,
    clearSelection,
    refreshRegistry,
  };

  return <DirectoryContext.Provider value={value}>{children}</DirectoryContext.Provider>;
}

function harnessesFor(next: Harness[]) {
  return harnessOptions.map((option) => option.value).filter((item) => next.includes(item));
}
