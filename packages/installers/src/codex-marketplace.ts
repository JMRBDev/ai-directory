import { parse } from 'jsonc-parser';
import { z } from 'zod';
import { resourceKey } from '@ai-directory/contracts';
import type { InstallPlan, PreparedText } from './install-plans.js';
import type { SharedOwnership } from './install-types.js';
import { hashContent } from './hashing.js';
import { currentFile } from './file-snapshots.js';

const marketplacePluginSchema = z
  .object({
    name: z.string().min(1),
    source: z
      .object({
        source: z.string().min(1),
        path: z.string().min(1),
      })
      .passthrough(),
    policy: z
      .object({
        installation: z.string().min(1),
        authentication: z.string().min(1),
      })
      .passthrough(),
    category: z.string().min(1),
  })
  .passthrough();

const marketplaceSchema = z
  .object({
    name: z.string().optional(),
    plugins: z.array(marketplacePluginSchema).optional(),
  })
  .passthrough();

type MarketplaceData = z.infer<typeof marketplaceSchema>;
type MarketplacePlugin = z.infer<typeof marketplacePluginSchema>;

type MarketplaceRemoval = {
  content: string;
  changed: boolean;
};

function marketplacePluginEntry(name: string): MarketplacePlugin {
  return {
    name,
    source: { source: 'local', path: `../.codex/plugins/${name}` },
    policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
    category: 'AI Directory',
  };
}

export async function prepareCodexMarketplace(
  marketplacePath: string,
  plans: InstallPlan[],
  force: boolean,
): Promise<PreparedText> {
  const current = await currentFile(marketplacePath);
  const data = current?.trim() ? parseMarketplace(current, marketplacePath) : {};
  const plugins = [...(data.plugins ?? [])];
  const requestedNames = new Set<string>();
  const ownership: SharedOwnership[] = [];

  for (const plan of plans) {
    const name = plan.resource.resource.name;
    if (requestedNames.has(name)) {
      throw new Error(`Codex plugin names overlap in this installation: ${name}.`);
    }
    requestedNames.add(name);

    const existing = plugins.findIndex((plugin) => plugin.name === name);

    if (existing !== -1) {
      const existingSource = plugins[existing]?.source;
      const expectedSource = marketplacePluginEntry(name).source;
      if (
        existingSource?.source !== expectedSource.source
        || existingSource.path !== expectedSource.path
      ) {
        throw new Error(
          `Codex marketplace name is already used by another source: ${name}.`,
        );
      }
      if (!force) {
        throw new Error(
          `Codex plugin is already registered in the marketplace: ${name}. Use --force to overwrite.`,
        );
      }
    }

    const entry = marketplacePluginEntry(name);
    ownership.push({
      path: marketplacePath,
      key: resourceKey(plan.resource.resource),
      hash: hashContent(JSON.stringify(entry)),
      created: current === null,
    });
    if (existing !== -1) plugins[existing] = entry;
    else plugins.push(entry);
  }

  return {
    path: marketplacePath,
    content: `${JSON.stringify({ name: data.name ?? 'ai-directory', plugins }, null, 2)}\n`,
    ownership,
  };
}

export function parseMarketplace(content: string, path: string): MarketplaceData {
  if (!content.trim()) return {};
  const errors: Array<{ error: number; offset: number; length: number }> = [];
  const result = marketplaceSchema.safeParse(parse(content, errors));

  if (errors.length > 0 || !result.success) {
    throw new Error(`Codex marketplace is not a valid object: ${path}`);
  }

  return result.data;
}

export function removeCodexMarketplacePlugin(
  content: string,
  name: string,
  path: string,
): MarketplaceRemoval {
  if (!content.trim()) return { content, changed: false };
  const data = parseMarketplace(content, path);

  if (!data.plugins) return { content, changed: false };

  const plugins = data.plugins.filter((plugin) => plugin.name !== name);
  if (plugins.length === data.plugins.length) return { content, changed: false };

  return {
    content: `${JSON.stringify({ ...data, plugins }, null, 2)}\n`,
    changed: true,
  };
}
