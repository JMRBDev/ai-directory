import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { ResourceType } from '@ai-directory/contracts';
import type {
  Action,
  ChangePlan,
  Harness,
  Installation,
  InstallScope,
  LocalResource,
} from './types';

export type StagedItem = {
  key: string;
  resource: string;
  type: ResourceType;
  action: Action;
  harnesses?: Harness[];
  scope?: InstallScope;
};

export type StagedMap = Record<string, StagedItem>;
export type ActionMap = Record<string, Action>;

export type ChangeDeckContextValue = {
  installations: Installation[];
  localResources: LocalResource[];
  localRegistryError: string | undefined;
  localLoading: boolean;
  staged: StagedMap;
  harnesses: Harness[];
  scope: InstallScope;
  plan: ChangePlan | null;
  planLoading: boolean;
  planStatus: string;
  planError: boolean;
  force: boolean;
  busy: boolean;
  stage: (item: StagedItem) => void;
  unstage: (key: string) => void;
  unstageResource: (resource: string) => void;
  clear: () => void;
  setHarnesses: (harnesses: Harness[]) => void;
  setScope: (scope: InstallScope) => void;
  setForce: (force: boolean) => void;
  loadLocalResources: () => Promise<void>;
  applyChanges: () => Promise<void>;
};

export const ChangeDeckContext = createContext<ChangeDeckContextValue | null>(null);

export function useChangeDeck(): ChangeDeckContextValue {
  const value = useContext(ChangeDeckContext);
  if (!value) throw new Error('useChangeDeck must be used within ChangeDeckProvider.');
  return value;
}
