import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '../../components/ui/alert-dialog';
import { Button } from '../../components/ui/button';
import { Field, FieldDescription, FieldLabel } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Separator } from '../../components/ui/separator';
import { Textarea } from '../../components/ui/textarea';
import { SheetFrame } from './common';
import { FolderPicker, folderPathFor } from './folder-picker';
import { ReviewCard } from './review-card';
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
  const [message, setMessage] = useState('');
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

  function formData() {
    const body = new FormData();
    body.set('resourceId', [resolvedOwner.trim(), type, name.trim()].join('/'));
    body.set('version', version.trim());
    if (description.trim()) body.set('description', description.trim());
    for (const file of files) body.append('files[]', file, folderPathFor(file));
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
      setMessage('Validation passed. Review the details, then submit the pull request.');
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

  const reviewDescription = description.trim() || 'Not found';
  const busy = validateMutation.isPending || submitMutation.isPending;
  const hasError = Boolean(userQuery.error || validateMutation.error || submitMutation.error);
  const statusMessage = userQuery.isPending
    ? 'Loading GitHub username…'
    : userQuery.error
      ? (userQuery.error instanceof Error ? userQuery.error.message : 'Could not load the GitHub username.')
      : message || 'Ready to validate.';

  return (
    <SheetFrame open={open} onOpenChange={onOpenChange} title="Publish resource" description="Validate a resource folder and submit it for review.">
      <form className="flex flex-col gap-5" onSubmit={(event) => { event.preventDefault(); void validate(); }}>
        <section className="flex flex-col gap-4">
          <h3 className="text-sm font-medium">Identity</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_10rem]">
            <Field>
              <FieldLabel htmlFor="publish-owner">GitHub user</FieldLabel>
              <Input id="publish-owner" type="text" value={owner || userQuery.data?.username || ''} placeholder="Loading…" onChange={(event) => updateField(() => setOwner(event.target.value))} disabled={!userQuery.error || busy} />
            </Field>
            <Field>
              <FieldLabel htmlFor="publish-type">Type</FieldLabel>
              <Select value={type} onValueChange={(value) => updateField(() => setType(resourceType(value)))} disabled={busy}>
                <SelectTrigger id="publish-type"><SelectValue /></SelectTrigger>
                <SelectContent>{RESOURCE_TYPES.map((option) => <SelectItem value={option.value} key={option.value}>{option.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field className="sm:col-span-2 lg:col-span-1">
              <FieldLabel htmlFor="publish-name">Name</FieldLabel>
              <Input id="publish-name" value={name} placeholder="my-resource" onChange={(event) => updateField(() => setName(event.target.value))} autoComplete="off" required disabled={busy} />
            </Field>
            <Field>
              <FieldLabel htmlFor="publish-version">Version</FieldLabel>
              <Input id="publish-version" value={version} onChange={(event) => updateField(() => setVersion(event.target.value))} autoComplete="off" required disabled={busy} />
            </Field>
          </div>
          <p className="break-all font-mono text-xs text-muted-foreground" aria-live="polite">{resolvedOwner ? `${resolvedOwner}/${type}/${name}` : 'Loading GitHub user…'}</p>
        </section>
        <Separator />
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">Files</h3>
          <FolderPicker files={files} onFiles={(nextFiles) => { setFiles(nextFiles); resetValidation(); }} busy={busy} />
        </section>
        {review && (
          <>
            <Separator />
            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">Description</h3>
              <Textarea rows={3} value={description} placeholder="Resource description" onChange={(event) => setDescription(event.target.value)} disabled={busy} />
              <FieldDescription>Inferred from the resource files.</FieldDescription>
            </section>
          </>
        )}
        <Separator />
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-3">
            <Button variant={review ? 'outline' : 'default'} type="submit" disabled={busy}>
              {validateMutation.isPending ? 'Validating…' : 'Validate'}
            </Button>
            {review && (
              <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogTrigger
                  render={
                    <Button type="button" variant="default" disabled={busy || submitted}>
                      {submitMutation.isPending ? 'Creating pull request…' : submitted ? 'Pull request created' : 'Submit pull request'}
                    </Button>
                  }
                />
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Create pull request?</AlertDialogTitle>
                    <AlertDialogDescription>This will submit the validated resource to the registry for review.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void submit()}>Create pull request</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
          <Alert variant={hasError ? 'destructive' : 'default'} role="status" aria-live="polite">
            <AlertDescription>{statusMessage}</AlertDescription>
          </Alert>
        </section>
        {review && <ReviewCard review={review} description={reviewDescription} pullRequestUrl={pullRequestUrl} />}
      </form>
    </SheetFrame>
  );
}
