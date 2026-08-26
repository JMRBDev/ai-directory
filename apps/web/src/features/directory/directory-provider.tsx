import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { harnessOptions, type ApplyResponse, type Harness, type InstallScope, type StagedItem, type StagedMap } from '../../lib/types';
import { DirectoryContext, type DirectoryContextValue } from './context';
import { readStorage, writeStorage } from '../../lib/theme';
import { groupStaged, hasApplyableOperation, mergePlans, operationsFor, type PlanData, type SheetName } from './model';

export function DirectoryProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [sheet, setSheet] = useState<SheetName>(null);
  const [staged, setStaged] = useState<StagedMap>(() => readStorage('ai-directory-staged', {}));
  const [harnesses, setHarnessesState] = useState<Harness[]>(() => {
    const stored = readStorage<Harness[]>('ai-directory-harnesses', ['claude-code']);
    return stored.length > 0 ? stored : ['claude-code'];
  });
  const [scope, setScope] = useState<InstallScope>('user');
  const [force, setForce] = useState(false);
  const [removeDependencies, setRemoveDependencies] = useState(false);

  const installationsQuery = useQuery({ queryKey: ['installed'], queryFn: api.installed });
  const localResourcesQuery = useQuery({ queryKey: ['local-resources'], queryFn: api.localResources });
  const harnessQuery = useQuery({ queryKey: ['harness-detection'], queryFn: api.harnesses });
  const stagedItems = Object.values(staged);
  const groups = groupStaged(stagedItems);
  const planQuery = useQuery<PlanData>({
    queryKey: ['plan', stagedItems, harnesses, scope],
    enabled: stagedItems.length > 0 && harnesses.length > 0,
    queryFn: async () => {
      const groupPlans = await Promise.all(groups.map(async (group) => ({ ...group, plan: await api.plan(operationsFor(group.items, harnesses, scope)) })));
      return { groups: groupPlans, plan: mergePlans(groupPlans.map((group) => group.plan)) };
    },
  });
  const applyMutation = useMutation({
    mutationFn: async ({ data, applyForce, removeDeps }: { data: PlanData; applyForce: boolean; removeDeps: boolean }) => {
      const results: ApplyResponse[] = [];
      for (const group of data.groups) {
        results.push(await api.apply({ operations: operationsFor(group.items, harnesses, scope), force: applyForce, installDependencies: true, removeDependencies: removeDeps, planFingerprint: group.plan.fingerprint }));
      }
      return results;
    },
    onSuccess: (results) => {
      const changes = results.reduce((total, result) => total + result.plan.changes.length, 0);
      const warnings = results.flatMap((result) => result.warnings ?? []);
      toast.success(warnings.length > 0 ? `Applied ${changes} file changes with warnings: ${warnings.join(' ')}` : `Applied ${changes} file changes.`);
      setStaged({});
      writeStorage('ai-directory-staged', {});
      setForce(false);
      setRemoveDependencies(false);
      void queryClient.invalidateQueries({ queryKey: ['installed'] });
      void queryClient.invalidateQueries({ queryKey: ['local-resources'] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not apply the change plan.'),
  });

  function setHarnesses(next: Harness[]) {
    const normalized = harnessesFor(next);
    if (normalized.length === 0) return;
    setHarnessesState(normalized);
    writeStorage('ai-directory-harnesses', normalized);
  }

  function saveStaged(next: StagedMap) {
    setStaged(next);
    writeStorage('ai-directory-staged', next);
  }

  function stage(item: StagedItem) {
    if (item.harnesses.length === 0) return;
    const normalized: StagedItem = { ...item, harnesses: [...new Set(item.harnesses)] };
    if (normalized.type === 'mcp-servers' && !normalized.scope) normalized.scope = scope;
    saveStaged({ ...staged, [normalized.key]: normalized });
    toast.success(`Added ${normalized.resource.split('/').at(-1)} to Changes.`);
  }

  function updateStage(item: StagedItem) {
    if (item.harnesses.length === 0) return;
    saveStaged({ ...staged, [item.key]: { ...item, harnesses: [...new Set(item.harnesses)] } });
  }

  function unstage(key: string) {
    const next = { ...staged };
    delete next[key];
    saveStaged(next);
  }

  function clear() {
    saveStaged({});
    setForce(false);
    setRemoveDependencies(false);
  }

  function applyChanges() {
    if (!planQuery.data || !hasApplyableOperation(planQuery.data.plan) || applyMutation.isPending) return;
    void applyMutation.mutateAsync({ data: planQuery.data, applyForce: force, removeDeps: removeDependencies });
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
    staged,
    harnesses,
    scope,
    sheet,
    plan: planQuery.data,
    planLoading: planQuery.isPending && stagedItems.length > 0,
    planError: planQuery.error instanceof Error ? planQuery.error.message : undefined,
    force,
    removeDependencies,
    busy: applyMutation.isPending,
    setSheet,
    setHarnesses,
    setScope,
    setForce,
    setRemoveDependencies,
    stage,
    updateStage,
    unstage,
    clear,
    applyChanges,
    refreshRegistry,
  };

  return <DirectoryContext.Provider value={value}>{children}</DirectoryContext.Provider>;
}

function harnessesFor(next: Harness[]) {
  return harnessOptions.map((option) => option.value).filter((item) => next.includes(item));
}
