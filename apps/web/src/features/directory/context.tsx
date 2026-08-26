import { createContext, useContext } from 'react';
import { api } from '../../lib/api';
import type { Harness, HarnessManagerStatus, InstallScope, LocalResource, StagedItem, StagedMap } from '../../lib/types';
import type { PlanData, SheetName } from './model';

export type DirectoryContextValue = {
  installations: NonNullable<Awaited<ReturnType<typeof api.installed>>['installations']>;
  localResources: LocalResource[];
  localError: string | undefined;
  localRegistryError: string | undefined;
  homeDirectory: string | undefined;
  localLoading: boolean;
  harnessDetection: HarnessManagerStatus[] | undefined;
  staged: StagedMap;
  harnesses: Harness[];
  scope: InstallScope;
  sheet: SheetName;
  plan: PlanData | undefined;
  planLoading: boolean;
  planError: string | undefined;
  force: boolean;
  removeDependencies: boolean;
  busy: boolean;
  setSheet: (sheet: SheetName) => void;
  setHarnesses: (harnesses: Harness[]) => void;
  setScope: (scope: InstallScope) => void;
  setForce: (force: boolean) => void;
  setRemoveDependencies: (remove: boolean) => void;
  stage: (item: StagedItem) => void;
  updateStage: (item: StagedItem) => void;
  unstage: (key: string) => void;
  clear: () => void;
  applyChanges: () => void;
  refreshRegistry: () => Promise<void>;
};

export const DirectoryContext = createContext<DirectoryContextValue | null>(null);

export function useDirectory() {
  const value = useContext(DirectoryContext);
  if (!value) throw new Error('useDirectory must be used inside DirectoryProvider.');
  return value;
}
