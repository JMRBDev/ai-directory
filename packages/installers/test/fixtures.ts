import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ResourceVersion } from '@ai-directory/registry';

export const resource = {
  resource: {
    owner: 'jose-rosendo',
    type: 'skills',
    name: 'typescript-api-review',
    description: 'Review a TypeScript API before it ships.',
    latestVersion: '1.0.0',
    reviewStatus: 'unreviewed',
    lifecycleStatus: 'active',
    visibility: 'public',
    updatedAt: '2026-08-11',
  },
  version: '1.0.0',
  files: [
    { path: 'SKILL.md', content: '# API review\n' },
    { path: 'references/checklist.md', content: '- Check errors\n' },
  ],
} satisfies ResourceVersion;

export const resourceWithCodexMetadata = {
  ...resource,
  files: [
    ...resource.files,
    { path: 'agents/openai.yaml', content: 'interface:\n  display_name: "API review"\n' },
  ],
} satisfies ResourceVersion;

export const agentResource = {
  ...resource,
  resource: {
    ...resource.resource,
    type: 'agents',
    name: 'api-reviewer',
  },
  files: [
    { path: 'AGENT.md', content: '# API reviewer\n' },
    { path: 'references/checklist.md', content: '- Check errors\n' },
  ],
} satisfies ResourceVersion;

export const ruleResource = {
  ...resource,
  resource: {
    ...resource.resource,
    type: 'rules',
    name: 'typescript-quality',
  },
  files: [
    { path: 'RULE.md', content: '# TypeScript quality\n' },
    { path: 'references/examples.md', content: '- Prefer narrow types\n' },
  ],
} satisfies ResourceVersion;

export const pluginResource = {
  ...resource,
  resource: {
    ...resource.resource,
    type: 'plugins',
    name: 'review-pack',
  },
  files: [
    {
      path: '.claude-plugin/plugin.json',
      content: '{"name":"review-pack","description":"A review pack.","version":"1.0.0"}\n',
    },
    { path: 'skills/reviewer/SKILL.md', content: '# Reviewer\n' },
    { path: '.opencode/plugin.ts', content: 'export const ReviewPack = async () => ({})\n' },
  ],
} satisfies ResourceVersion;

export const toolResource = {
  ...resource,
  resource: {
    ...resource.resource,
    type: 'tools',
    name: 'rtk',
  },
  files: [
    {
      path: 'TOOL.md',
      content: '---\nname: rtk\ndescription: Reduce shell output.\ncommand: rtk\nexecutables:\n  - bin/rtk\n---\n# RTK\n',
    },
    {
      path: '.claude-plugin/plugin.json',
      content: '{"name":"rtk","description":"Reduce shell output."}\n',
    },
    {
      path: '.codex-plugin/plugin.json',
      content: '{"name":"rtk","description":"Reduce shell output."}\n',
    },
    { path: '.opencode/plugin.ts', content: 'export const RTK = async () => ({})\n' },
    { path: '.opencode/tools/rtk.ts', content: 'export const tool = {}\n' },
    { path: 'bin/rtk', content: '#!/bin/sh\nprintf "rtk\\n"\n' },
  ],
} satisfies ResourceVersion;

const temporaryDirectories: string[] = [];

export async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'ai-directory-install-'));
  temporaryDirectories.push(directory);
  return directory;
}

export function cleanupTemporaryDirectories(): Promise<void> {
  return Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  ).then(() => undefined);
}
