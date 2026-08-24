import { useRef } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { FolderOpenIcon } from '@hugeicons/core-free-icons';
import { Button } from '../../components/ui/button';
import { Field, FieldDescription, FieldLabel } from '../../components/ui/field';
import { ScrollArea } from '../../components/ui/scroll-area';
import type { DirectoryFile } from './model';

export function folderPathFor(file: DirectoryFile) {
  const path = file.webkitRelativePath || file.name;
  const parts = path.split('/');
  return parts.length > 1 ? parts.slice(1).join('/') : path;
}

export function FolderPicker({ files, onFiles, busy }: {
  files: DirectoryFile[];
  onFiles: (files: DirectoryFile[]) => void;
  busy: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const paths = files.map(folderPathFor).sort();
  const folder = files[0]?.webkitRelativePath?.split('/')[0];

  return (
    <div className="flex flex-col gap-3">
      <Field>
        <FieldLabel>Resource folder</FieldLabel>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
            <HugeiconsIcon icon={FolderOpenIcon} size={16} /> Choose folder
          </Button>
          <p className="min-w-0 truncate text-sm text-muted-foreground" aria-live="polite">
            {files.length === 0 ? 'No folder chosen' : `${folder ?? 'Selection'} · ${files.length} file${files.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <input
          ref={(element) => { inputRef.current = element; element?.setAttribute('webkitdirectory', ''); }}
          id="publish-files"
          type="file"
          multiple
          hidden
          aria-label="Resource files directory"
          onChange={(event) => onFiles(Array.from(event.currentTarget.files ?? []))}
          disabled={busy}
        />
        <FieldDescription>Choose the folder that contains the resource files.</FieldDescription>
      </Field>
      {paths.length > 0 && (
        <ScrollArea className="h-36 rounded-lg border p-3">
          <ul aria-live="polite" className="font-mono text-xs text-muted-foreground">
            {paths.slice(0, 12).map((path) => <li className="py-0.5" key={path}>{path}</li>)}
            {paths.length > 12 && <li className="py-0.5">…and {paths.length - 12} more</li>}
          </ul>
        </ScrollArea>
      )}
    </div>
  );
}
