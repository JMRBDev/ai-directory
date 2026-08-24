import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const yamlMetadataSchema = z.object({
  description: z.string().optional(),
});

function oneLine(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

export function inferResourceDescription(content: string): string | undefined {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);

  if (frontmatter) {
    try {
      const result = yamlMetadataSchema.safeParse(parseYaml(frontmatter[1] ?? ''));
      const description = result.success ? result.data.description?.trim() : undefined;
      if (description) return oneLine(description);
    } catch {
      // The resource validator reports malformed template frontmatter separately.
    }
  }

  const body = frontmatter ? content.slice(frontmatter[0].length) : content;
  const blocks = body
    .split(/\n\s*\n/u)
    .map((block) => oneLine(block))
    .filter((block) => block && !block.startsWith('#') && !block.startsWith('```'));

  if (blocks[0]) return blocks[0];

  const heading = body.match(/^\s*#{1,6}\s+(.+)$/mu)?.[1];
  return heading ? oneLine(heading) : undefined;
}
