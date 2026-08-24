import { useMemo, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { File02Icon } from '@hugeicons/core-free-icons';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../../components/ui/accordion';
import { ToggleGroup, ToggleGroupItem } from '../../components/ui/toggle-group';
import { MarkdownView } from '../../components/markdown-view';
import type { ResourceVersion } from '@ai-directory/contracts';
import { isMarkdownPath } from './model';
import { DirectoryEmpty } from './shared';

export function FilesSection({ version, hasError }: {
  version: ResourceVersion | undefined;
  hasError: boolean;
}) {
  const [view, setView] = useState<'rendered' | 'text'>('rendered');
  const files = useMemo(() => version?.files ?? [], [version]);
  const hasMarkdown = files.some((file) => isMarkdownPath(file.path));

  return (
    <section aria-labelledby="files-title" className="min-w-0">
      <div className="mt-3 flex items-center justify-between gap-3">
        <h2 id="files-title" className="text-sm font-medium">Source files</h2>
        {hasMarkdown && (
          <ToggleGroup
            className="w-auto"
            value={[view]}
            onValueChange={(value) => { const next = value[0]; if (next === 'rendered' || next === 'text') setView(next); }}
            aria-label="File view mode"
          >
            <ToggleGroupItem value="rendered">Rendered</ToggleGroupItem>
            <ToggleGroupItem value="text">Text</ToggleGroupItem>
          </ToggleGroup>
        )}
      </div>
      {version ? (
        <Accordion multiple defaultValue={files[0] ? [files[0].path] : []} className="mt-3">
          {files.map((file) => (
            <AccordionItem key={file.path} value={file.path}>
              <AccordionTrigger className="gap-2 px-3 py-2.5 hover:no-underline">
                <HugeiconsIcon icon={File02Icon} size={15} className="text-muted-foreground" />
                <code className="min-w-0 flex-1 truncate text-left font-mono">{file.path}</code>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-3 pt-1">
                {isMarkdownPath(file.path) && view === 'rendered' ? (
                  <div className="max-h-80 overflow-y-auto">
                    <MarkdownView content={file.content} />
                  </div>
                ) : (
                  <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words font-mono leading-5"><code>{file.content}</code></pre>
                )}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      ) : !hasError ? (
        <DirectoryEmpty
          className="mt-3"
          icon={<HugeiconsIcon icon={File02Icon} />}
          title="No files found"
          description="The registry index points to a package with no readable files."
        />
      ) : null}
    </section>
  );
}
