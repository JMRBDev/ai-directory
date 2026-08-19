import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check } from '@phosphor-icons/react/dist/csr/Check';
import { Info } from '@phosphor-icons/react/dist/csr/Info';
import { api } from '../../lib/api';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '../../components/ui/alert-dialog';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Field, FieldLabel } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { ScrollArea } from '../../components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import { cn } from '../../lib/utils';
import { SheetFrame } from './common';
import { RESOURCE_TYPES, resourceType, type DirectoryFile, type PublishReview } from './model';
import type { ResourceType } from '../../lib/types';

export function PublishSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [owner, setOwner] = useState('');
  const [type, setType] = useState<ResourceType>('skills');
  const [name, setName] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<DirectoryFile[]>([]);
  const [review, setReview] = useState<PublishReview | null>(null);
  const [message, setMessage] = useState('Loading GitHub username…');
  const [pullRequestUrl, setPullRequestUrl] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const userQuery = useQuery({ queryKey: ['github-user'], queryFn: api.githubUser, enabled: open && owner.length === 0 });
  const validateMutation = useMutation({ mutationFn: (body: FormData) => api.validate(body) });
  const submitMutation = useMutation({ mutationFn: (body: FormData) => api.submit(body) });
  const resolvedOwner = owner || userQuery.data?.username || '';

  function resetValidation() {
    setReview(null);
    setPullRequestUrl('');
    setSubmitted(false);
    setMessage('Ready to validate.');
  }

  function pathFor(file: DirectoryFile) {
    const path = file.webkitRelativePath || file.name;
    const parts = path.split('/');
    return parts.length > 1 ? parts.slice(1).join('/') : path;
  }

  function formData() {
    const body = new FormData();
    body.set('resourceId', [resolvedOwner.trim(), type, name.trim()].join('/'));
    body.set('version', version.trim());
    if (description.trim()) body.set('description', description.trim());
    for (const file of files) body.append('files[]', file, pathFor(file));
    return body;
  }

  async function validate() {
    if (files.length === 0) {
      setMessage('Choose a resource folder first.');
      return;
    }
    if (!resolvedOwner.trim()) {
      setMessage('The authenticated GitHub username is required.');
      return;
    }
    resetValidation();
    try {
      const result = await validateMutation.mutateAsync(formData());
      const nextReview: PublishReview = { resource: result.resource, version: result.version, description: (result.description ?? '').trim(), entryFile: result.entryFile, files: result.files };
      setReview(nextReview);
      setDescription(nextReview.description);
      setMessage('Validation passed. Review the files, then submit the pull request.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Validation failed.');
    }
  }

  async function submit() {
    if (!review || submitted) return;
    setMessage('Creating pull request…');
    try {
      const result = await submitMutation.mutateAsync(formData());
      setPullRequestUrl(result.pullRequestUrl);
      setSubmitted(true);
      setMessage(result.pullRequestUrl ? 'Pull request created.' : 'Pull request created without a URL.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Submit failed.');
    }
  }

  function updateField(update: () => void) {
    update();
    resetValidation();
  }

  const paths = files.map(pathFor).sort();
  const folder = files[0]?.webkitRelativePath?.split('/')[0];
  const reviewDescription = description.trim() || 'Not found';
  const busy = validateMutation.isPending || submitMutation.isPending;
  const userStatus = userQuery.isPending ? 'Loading GitHub username…' : userQuery.error instanceof Error ? userQuery.error.message : message;

  return (
    <SheetFrame open={open} onOpenChange={onOpenChange} title="Publish resource" description="Validate a resource folder and submit it for review.">
      <div className="space-y-8 py-6">
        <form className="space-y-8" onSubmit={(event) => { event.preventDefault(); void validate(); }}>
          <Card className="bg-muted/20 p-4 sm:p-5">
            <CardHeader className="p-0"><CardTitle className="text-base">Resource identity</CardTitle></CardHeader>
            <CardContent className="p-0 pt-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_10rem]">
                <Field><FieldLabel htmlFor="publish-owner">GitHub user</FieldLabel><Input id="publish-owner" type="text" value={owner || userQuery.data?.username || ''} placeholder="Loading…" onChange={(event) => updateField(() => setOwner(event.target.value))} disabled={!userQuery.error || busy} /></Field>
                <Field><FieldLabel htmlFor="publish-type">Type</FieldLabel><Select value={type} onValueChange={(value) => updateField(() => setType(resourceType(value)))} disabled={busy}><SelectTrigger id="publish-type"><SelectValue /></SelectTrigger><SelectContent>{RESOURCE_TYPES.map((option) => <SelectItem value={option.value} key={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></Field>
                <Field className="sm:col-span-2 lg:col-span-1"><FieldLabel htmlFor="publish-name">Name</FieldLabel><Input id="publish-name" value={name} placeholder="my-resource" onChange={(event) => updateField(() => setName(event.target.value))} autoComplete="off" required disabled={busy} /></Field>
                <Field><FieldLabel htmlFor="publish-version">Version</FieldLabel><Input id="publish-version" value={version} onChange={(event) => updateField(() => setVersion(event.target.value))} autoComplete="off" required disabled={busy} /></Field>
              </div>
              <output className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg bg-background px-3 py-2" aria-live="polite"><span className="text-xs font-medium text-muted-foreground">Resource ID</span><code className="break-all font-mono text-xs">{resolvedOwner ? [resolvedOwner, type, name].join('/') : 'Loading GitHub user…'}</code></output>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="p-0"><CardTitle className="text-base">Resource files</CardTitle><CardDescription className="mt-2">Choose the folder that contains the resource files.</CardDescription></CardHeader>
            <CardContent className="p-0 pt-4">
              <Input className="mt-3" type="file" multiple required aria-label="Resource files directory" ref={(element) => element?.setAttribute('webkitdirectory', '')} onChange={(event) => { setFiles(Array.from(event.currentTarget.files ?? [])); resetValidation(); }} disabled={busy} />
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Badge variant="muted">{paths.length} file{paths.length === 1 ? '' : 's'}</Badge>{folder && <span>Folder: {folder}</span>}</div>
              {paths.length > 0 ? <Card className="mt-4 bg-muted/20" aria-live="polite"><CardContent className="p-4"><p className="text-sm font-semibold">Files to publish</p><ScrollArea className="mt-3 h-40"><ul className="font-mono text-xs text-muted-foreground">{paths.slice(0, 12).map((path) => <li className="py-1" key={path}>{path}</li>)}{paths.length > 12 && <li className="py-1">…and {paths.length - 12} more</li>}</ul></ScrollArea></CardContent></Card> : <Alert className="mt-4 border-blue-500/30 bg-blue-500/5 text-muted-foreground"><Info size={17} /><AlertDescription>No resource folder selected.</AlertDescription></Alert>}
            </CardContent>
          </Card>
          {review && <Card className="bg-muted/20 p-4 sm:p-5"><CardHeader className="p-0"><CardTitle className="text-base">Description</CardTitle><CardDescription className="mt-2">Inferred from the resource files. Edit it before submitting if needed.</CardDescription></CardHeader><CardContent className="p-0 pt-4"><Textarea rows={3} value={description} placeholder="Resource description" onChange={(event) => setDescription(event.target.value)} disabled={busy} /></CardContent></Card>}
          <div className="border-t pt-5">
            <div className="flex flex-wrap gap-3">
              <Button variant={review ? 'outline' : 'default'} type="submit" disabled={busy}>{validateMutation.isPending ? 'Validating…' : 'Validate resource'}</Button>
              {review && <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogTrigger asChild><Button type="button" disabled={busy || submitted}>{submitMutation.isPending ? 'Creating pull request…' : submitted ? 'Pull request created' : 'Submit pull request'}</Button></AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader><AlertDialogTitle>Create pull request?</AlertDialogTitle><AlertDialogDescription>This will submit the validated resource to the registry for review.</AlertDialogDescription></AlertDialogHeader>
                  <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => void submit()}>Create pull request</AlertDialogAction></AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>}
            </div>
            <Alert className={cn('mt-4 border p-3', userQuery.error || validateMutation.error || submitMutation.error ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'border-blue-500/30 bg-blue-500/5 text-muted-foreground')} role="status" aria-live="polite"><Info size={17} /><AlertDescription>{userStatus}</AlertDescription></Alert>
          </div>
        </form>
        {review && <Card className="bg-muted/20" aria-labelledby="publish-review-title"><CardHeader><div className="flex flex-wrap items-start justify-between gap-4"><div><CardTitle id="publish-review-title" className="text-lg">Ready to submit</CardTitle><CardDescription className="mt-2">Check these details before creating the pull request.</CardDescription></div><Badge variant="success">Validated</Badge></div></CardHeader><CardContent><dl className="grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-xs font-medium text-muted-foreground">Resource</dt><dd className="mt-1 break-all font-mono text-xs">{review.resource}</dd></div><div><dt className="text-xs font-medium text-muted-foreground">Version</dt><dd className="mt-1">{review.version}</dd></div><div><dt className="text-xs font-medium text-muted-foreground">Entry file</dt><dd className="mt-1 break-all font-mono text-xs">{review.entryFile}</dd></div><div><dt className="text-xs font-medium text-muted-foreground">Files</dt><dd className="mt-1">{review.files.length} file{review.files.length === 1 ? '' : 's'}</dd></div><div className="sm:col-span-2"><dt className="text-xs font-medium text-muted-foreground">Description</dt><dd className="mt-1 leading-6">{reviewDescription}</dd></div></dl><p className="mt-6 text-sm leading-6 text-muted-foreground">The pull request stays unreviewed until the curation team reviews and merges it.</p>{pullRequestUrl && <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-300"><Check className="mr-2 inline" size={17} /><Button asChild variant="link" size="sm" className="h-auto p-0 font-semibold"><a href={pullRequestUrl} target="_blank" rel="noreferrer">Open pull request</a></Button></div>}</CardContent></Card>}
      </div>
    </SheetFrame>
  );
}
