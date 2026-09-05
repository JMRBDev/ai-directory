import { defineCommand } from 'citty';
import { getRepositorySetting } from '@ai-directory/config';
import type { HarnessDetection } from '@ai-directory/installers';
import { detectHarnesses } from '@ai-directory/installers';
import { readRemoteRegistryIndex } from '@ai-directory/registry';

interface RegistryDiagnostics {
  ok: boolean;
  repository: string | null;
  source: string;
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
    const setting = getRepositorySetting(args.repository);
    const diagnostics: RegistryDiagnostics = {
      ok: false,
      repository: setting.value ?? null,
      source: setting.source,
      branch: args.base ?? 'main',
      harnesses: await detectHarnesses(),
    };

    if (!setting.value) {
      diagnostics.error = 'No registry repository is configured. Run aid setup.';
    } else {
      try {
        const index = await readRemoteRegistryIndex({
          repositoryUrl: setting.value,
          baseBranch: args.base,
        });
        diagnostics.ok = true;
        diagnostics.resourceCount = index.resources.length;
        diagnostics.activeCount = index.resources.filter(
          (resource) => resource.lifecycleStatus === 'active',
        ).length;
        diagnostics.unreviewedCount = index.resources.filter(
          (resource) => resource.reviewStatus === 'unreviewed',
        ).length;
      } catch (error) {
        diagnostics.error = error instanceof Error ? error.message : String(error);
      }
    }

    if (args.json) {
      console.log(JSON.stringify(diagnostics, null, 2));
    } else {
      console.log(`Repository: ${diagnostics.repository ?? 'not configured'}`);
      console.log(`Source: ${diagnostics.source}`);
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
