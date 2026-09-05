import { join } from 'node:path';
import { configuredPath, pathExists } from '@ai-directory/config';
import { applyEdits, modify, parse } from 'jsonc-parser';
import { z } from 'zod';
import { resolveHarnessPaths } from './harnesses.js';
import type { InstallOptions } from './install-types.js';
import type { PreparedText } from './install-plans.js';
import type { SharedOwnership } from './install-types.js';
import { hashContent } from './hashing.js';

const openCodeConfigSchema = z.object({
  instructions: z.array(z.string()).optional(),
});

const openCodeConfigDataSchema = z.record(z.string(), z.unknown());

export function readOpenCodeInstructions(current: string, path: string): string[] | undefined {
  const errors: Array<{ error: number; offset: number; length: number }> = [];
  const data = parse(current, errors, { allowTrailingComma: true });

  if (errors.length > 0) {
    throw new Error(`OpenCode config is not a valid object: ${path}`);
  }

  const result = openCodeConfigSchema.safeParse(data);

  if (!result.success) {
    const issue = result.error.issues[0];
    if (issue?.path[0] === 'instructions') {
      throw new Error(`OpenCode config instructions must be an array of strings: ${path}`);
    }
    throw new Error(`OpenCode config is not a valid object: ${path}`);
  }

  return result.data.instructions;
}

export function isEmptyOpenCodeConfig(current: string): boolean {
  const errors: Array<{ error: number; offset: number; length: number }> = [];
  const data = parse(current, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    return false;
  }

  const parsed = openCodeConfigDataSchema.safeParse(data);
  if (!parsed.success) return false;

  const config = openCodeConfigSchema.safeParse(parsed.data);
  if (!config.success) return false;

  return Object.keys(parsed.data).every((key) => key === 'instructions')
    && (config.data.instructions?.length ?? 0) === 0;
}

export async function pickOpenCodeConfig(candidates: string[]): Promise<string> {
  for (const path of candidates) {
    if (await pathExists(path)) {
      return path;
    }
  }

  return candidates[candidates.length - 1] ?? '';
}

export async function openCodeConfigPath(
  root: string,
  options: InstallOptions,
): Promise<string> {
  const customPath = configuredPath(options.environment ?? process.env, 'OPENCODE_CONFIG');

  if (customPath) {
    return customPath;
  }

  return pickOpenCodeConfig([join(root, 'opencode.jsonc'), join(root, 'opencode.json')]);
}

export function openCodeInstallRoot(options: InstallOptions): string {
  return resolveHarnessPaths('opencode', options).root;
}

function writeInstructionsConfig(current: string | null, instructions: string[]): string {
  if (current === null) {
    return `${JSON.stringify({ instructions }, null, 2)}\n`;
  }

  return applyEdits(
    current,
    modify(current, ['instructions'], instructions, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    }),
  );
}

export async function addOpenCodeInstructions(
  path: string,
  current: string | null,
  entries: Array<{ key: string; entry: string }>,
): Promise<PreparedText> {
  const instructions = current === null ? [] : [...(readOpenCodeInstructions(current, path) ?? [])];
  const ownership: SharedOwnership[] = [];

  for (const { key, entry } of entries) {
    if (instructions.includes(entry)) continue;
    instructions.push(entry);
    ownership.push({ path, key, hash: hashContent(entry), created: current === null });
  }

  return { path, content: writeInstructionsConfig(current, instructions), ownership };
}

export async function removeOpenCodeInstructions(
  path: string,
  current: string,
  keep: (entry: string) => boolean,
): Promise<string> {
  const currentInstructions = readOpenCodeInstructions(current, path) ?? [];
  return writeInstructionsConfig(current, currentInstructions.filter(keep));
}
