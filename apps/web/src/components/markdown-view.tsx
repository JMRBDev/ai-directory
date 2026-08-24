import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { cn } from '../lib/utils';

const FRONTMATTER_PATTERN = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

export function stripFrontmatter(content: string) {
  const match = FRONTMATTER_PATTERN.exec(content);
  return match ? content.slice(match[0].length) : content;
}

export function MarkdownView({ content, className }: { content: string; className?: string }) {
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(stripFrontmatter(content), { async: false, gfm: true })),
    [content],
  );

  return (
    <div
      className={cn('prose prose-sm dark:prose-invert max-w-none', className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
