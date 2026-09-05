import { createContext, useContext } from 'react';
import { api } from '../../lib/api';
import type { Harness, HarnessManagerStatus, InstallScope, LocalResource } from '../../lib/types';
import type { SheetName } from './model';

export type BatchEntry = {
  id: string;
  harnesses: Harness[];
};

export type DirectoryContextValue = {
  installations: NonNullable<Awaited<ReturnType<typeof api.installed>>['installations']>;
  localResources: LocalResource[];
  localError: string | undefined;
  localRegistryError: string | undefined;
  homeDirectory: string | undefined;
  localLoading: boolean;
  harnessDetection: HarnessManagerStatus[] | undefined;
  harnesses: Harness[];
  scope: InstallScope;
  sheet: SheetName;
  selection: BatchEntry[];
  setSheet: (sheet: SheetName) => void;
  setHarnesses: (harnesses: Harness[]) => void;
  setScope: (scope: InstallScope) => void;
  toggleSelected: (id: string) => void;
  setEntryHarnesses: (id: string, harnesses: Harness[]) => void;
  clearSelection: () => void;
  refreshRegistry: () => Promise<void>;
};

export const DirectoryContext = createContext<DirectoryContextValue | null>(null);

export function useDirectory() {
  const value = useContext(DirectoryContext);
  if (!value) throw new Error('useDirectory must be used inside DirectoryProvider.');
  return value;
}
