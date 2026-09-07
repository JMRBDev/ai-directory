import { defineCommand } from 'citty';
import { readRegistryEntries } from '@ai-directory/config';
import type { HarnessDetection } from '@ai-directory/installers';
import { detectHarnesses } from '@ai-directory/installers';
import { readRemoteRegistryIndex } from '@ai-directory/registry';

interface RegistryDiagnostics {
  ok: boolean;
  registries: Array<{ id: string; url: string; branch: string; resourceCount?: number; error?: string }>;
  branch: string;
  resourceCount?: number;
  activeCount?: number;
  unreviewedCount?: number;
  harnesses: HarnessDetection[];
  error?: string;
}

export const doctor = defineCommand({
  meta: {
    name: 'doctor',
    description: 'Check registry configuration and Git access',
  },
  args: {
    repository: {
      type: 'string',
      description: 'Registry Git URL override',
    },
    registry: {
      type: 'string',
      description: 'Registry id to check; defaults to all registries',
    },
    base: {
      type: 'string',
      default: 'main',
      description: 'Production branch to check',
    },
    json: {
      type: 'boolean',
      description: 'Print machine-readable diagnostics',
    },
  },
  async run({ args }) {
    const entries = args.repository?.trim()
      ? [{ id: 'override', url: args.repository.trim(), scope: 'user' as const }]
      : readRegistryEntries().filter((entry) =>
        !args.registry?.trim() || entry.id === args.registry.trim().toLowerCase(),
      );
    const diagnostics: RegistryDiagnostics = {
      ok: false,
      registries: [],
      branch: args.base ?? 'main',
      harnesses: await detectHarnesses(),
    };

    if (entries.length === 0) {
      diagnostics.error = 'No registry repository is configured. Run aid setup.';
    } else {
      let total = 0;
      let active = 0;
      let unreviewed = 0;
      for (const entry of entries) {
        const branch = args.repository?.trim() ? (args.base ?? 'main') : entry.branch ?? args.base ?? 'main';
        try {
          const index = await readRemoteRegistryIndex({
            repositoryUrl: entry.url,
            baseBranch: branch,
          });
          diagnostics.registries.push({ id: entry.id, url: entry.url, branch, resourceCount: index.resources.length });
          total += index.resources.length;
          active += index.resources.filter((resource) => resource.lifecycleStatus === 'active').length;
          unreviewed += index.resources.filter((resource) => resource.reviewStatus === 'unreviewed').length;
        } catch (error) {
          diagnostics.registries.push({
            id: entry.id,
            url: entry.url,
            branch,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      diagnostics.ok = diagnostics.registries.some((entry) => entry.error === undefined);
      diagnostics.resourceCount = total;
      diagnostics.activeCount = active;
      diagnostics.unreviewedCount = unreviewed;
      if (!diagnostics.ok) {
        diagnostics.error = diagnostics.registries.map((entry) => `${entry.id}: ${entry.error}`).join('; ');
      }
    }

    if (args.json) {
      console.log(JSON.stringify(diagnostics, null, 2));
    } else {
      for (const registry of diagnostics.registries) {
        console.log(`Registry ${registry.id}: ${registry.url} (branch ${registry.branch})`);
      }
      if (diagnostics.registries.length === 0) console.log('Registries: not configured');
      console.log(`Branch: ${diagnostics.branch}`);
      console.log('Harnesses:');

      for (const harness of diagnostics.harnesses) {
        const signals = [
          harness.executable ? `command=${harness.executable}` : undefined,
          ...harness.paths.map((path) => `path=${path}`),
        ].filter((signal): signal is string => signal !== undefined);

        console.log(`  ${harness.displayName}: ${signals.join(', ') || 'not detected'}`);
      }

      if (diagnostics.ok) {
        console.log(`Registry: reachable (${diagnostics.resourceCount} resource(s))`);
        console.log(`Active: ${diagnostics.activeCount}`);
        console.log(`Unreviewed: ${diagnostics.unreviewedCount}`);
      } else {
        console.error(`Registry: unavailable. ${diagnostics.error}`);
      }
    }

    if (!diagnostics.ok) process.exitCode = 1;
  },
});
