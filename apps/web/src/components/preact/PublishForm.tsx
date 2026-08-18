import { useState } from 'preact/hooks';
import { z } from 'zod';
import { useMountEffect } from './useMountEffect';
import { closeDrawers, errorMessage, request } from './api';
import { API_PATHS, DRAWER_TOGGLES, RESOURCE_TYPE_LABELS, useStatus } from './lib';
import DrawerShell from './DrawerShell';

type Props = {
  apiUrl: string;
};

type DirectoryFile = File & {
  webkitRelativePath?: string;
};

type Review = {
  resource: string;
  version: string;
  entryFile: string;
  files: string[];
  description: string;
};

const apiResultSchema = z.object({
  error: z.string().optional(),
  username: z.string().min(1).optional(),
  pullRequestUrl: z.string().optional(),
  resource: z.string().optional(),
  version: z.string().optional(),
  entryFile: z.string().optional(),
  files: z.array(z.string()).optional(),
  description: z.string().optional(),
});

function pathFor(file: DirectoryFile) {
  const path = file.webkitRelativePath || file.name;
  const parts = path.split('/');
  return parts.length > 1 ? parts.slice(1).join('/') : path;
}

export default function PublishForm({ apiUrl }: Props) {
  const [owner, setOwner] = useState('');
  const [type, setType] = useState('skills');
  const [name, setName] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [files, setFiles] = useState<DirectoryFile[]>([]);
  const [description, setDescription] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const [validated, setValidated] = useState(false);
  const { status, error, showStatus } = useStatus('Loading GitHub username…');
  const [busy, setBusy] = useState(false);
  const [pullRequestUrl, setPullRequestUrl] = useState('');

  useMountEffect(() => {
    void loadGithubUsername();
  });

  async function loadGithubUsername() {
    try {
      const result = apiResultSchema.parse(await request<unknown>(apiUrl, API_PATHS.githubUser));
      const username = result.username?.trim();
      if (!username) {
        throw new Error(result.error ?? 'Could not determine the GitHub username.');
      }
      setOwner(username);
      showStatus('Ready to validate.');
    } catch (cause) {
      showStatus(errorMessage(cause, 'Could not determine the GitHub username.'), true);
    }
  }

  function resetValidation() {
    setValidated(false);
    setReview(null);
    setPullRequestUrl('');
  }

  function onFilesChange(event: Event) {
    // SAFETY: The handler is attached to the resource directory file input.
    const input = event.currentTarget as HTMLInputElement;
    // SAFETY: A file input produces File objects, which satisfy DirectoryFile.
    setFiles(Array.from(input.files ?? []) as DirectoryFile[]);
    resetValidation();
  }

  function formData() {
    const data = new FormData();
    data.set('resourceId', [owner.trim(), type, name.trim()].join('/'));
    data.set('version', version.trim());
    if (description.trim()) data.set('description', description.trim());
    for (const file of files) data.append('files[]', file, pathFor(file));
    return data;
  }

  async function submit(path: string) {
    return request<unknown>(apiUrl, path, {
      method: 'POST',
      body: formData(),
    });
  }

  async function validateResource(event: SubmitEvent) {
    event.preventDefault();
    if (files.length === 0) {
      showStatus('Select a resource directory first.', true);
      return;
    }
    if (!owner.trim()) {
      showStatus('The authenticated GitHub username is required.', true);
      return;
    }

    setBusy(true);
    showStatus('Validating resource…');
    try {
      const result = apiResultSchema.parse(await submit(API_PATHS.validate));
      const nextReview = {
        resource: result.resource ?? [owner, type, name].join('/'),
        version: result.version ?? version,
        entryFile: result.entryFile ?? 'Not found',
        files: result.files ?? [],
        description: (result.description ?? '').trim(),
      };
      setReview(nextReview);
      setDescription(nextReview.description);
      setValidated(true);
      showStatus('Validation passed. Review the files, then submit the pull request.');
    } catch (cause) {
      showStatus(errorMessage(cause, 'Could not validate the resource.'), true);
    } finally {
      setBusy(false);
    }
  }

  async function submitResource() {
    if (!validated || !window.confirm('Create this pull request?')) return;

    setBusy(true);
    showStatus('Creating pull request…');
    try {
      const result = apiResultSchema.parse(await submit(API_PATHS.submit));
      const url = result.pullRequestUrl ?? '';
      setPullRequestUrl(url);
      setValidated(false);
      showStatus(url ? 'Pull request created: ' + url : 'Pull request created.');
    } catch (cause) {
      showStatus(errorMessage(cause, 'Could not create the pull request.'), true);
    } finally {
      setBusy(false);
    }
  }

  const paths = files.map(pathFor).sort();
  const folder = files[0]?.webkitRelativePath?.split('/')[0];
  const reviewDescription = description.trim() || 'Not found';
  const composedId = owner ? [owner, type, name].join('/') : 'Loading GitHub user…';

  const content = (
    <section className="w-full">
      <form className="space-y-8" onSubmit={(event) => void validateResource(event)}>
        <fieldset className="fieldset rounded-box border border-base-300 bg-base-200/30 p-4 sm:p-5">
          <legend className="fieldset-legend px-2 text-base font-semibold">Resource identity</legend>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_10rem]">
            <label className="fieldset">
              <span className="fieldset-legend">GitHub user</span>
              <input className="input w-full" type="text" value={owner} placeholder="Loading…" disabled />
            </label>
            <label className="fieldset">
              <span className="fieldset-legend">Type</span>
              <select className="select w-full" value={type} onChange={(event) => { setType(event.currentTarget.value); resetValidation(); }} required disabled={busy}>
                {Object.entries(RESOURCE_TYPE_LABELS).map(([value, label]) => (
                  <option value={value} key={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="fieldset sm:col-span-2 lg:col-span-1">
              <span className="fieldset-legend">Name</span>
              <input className="input w-full" type="text" value={name} placeholder="my-resource" onInput={(event) => { setName(event.currentTarget.value); resetValidation(); }} autoComplete="off" required disabled={busy} />
            </label>
            <label className="fieldset">
              <span className="fieldset-legend">Version</span>
              <input className="input w-full" type="text" value={version} onInput={(event) => { setVersion(event.currentTarget.value); resetValidation(); }} autoComplete="off" required disabled={busy} />
            </label>
          </div>
          <output className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-box bg-base-100 px-3 py-2" aria-live="polite">
            <span className="text-xs font-medium text-base-content/60">Resource ID</span>
            <code className="break-all font-mono text-xs text-base-content">{composedId}</code>
          </output>
        </fieldset>

        <fieldset className="fieldset">
          <legend className="fieldset-legend text-base font-semibold">Resource files</legend>
          <p className="text-sm text-base-content/60">Choose the folder that contains the resource files.</p>
          <input className="file-input mt-2 w-full" type="file" multiple required aria-label="Resource files directory" ref={(element) => element?.setAttribute('webkitdirectory', '')} onChange={onFilesChange} disabled={busy} />
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-base-content/60">
            <span className="badge badge-ghost">{paths.length} file{paths.length === 1 ? '' : 's'}</span>
            {folder && <span>Folder: {folder}</span>}
          </div>
          {paths.length > 0 ? (
            <div className="mt-4 rounded-box border border-base-300 bg-base-200/50 p-4" aria-live="polite">
              <p className="text-sm font-semibold text-base-content">Files to publish</p>
              <ul className="list list-sm mt-3 max-h-40 overflow-y-auto font-mono text-xs text-base-content/70">
                {paths.slice(0, 12).map((path) => <li className="list-row px-0 py-1" key={path}>{path}</li>)}
                {paths.length > 12 && <li className="list-row px-0 py-1">...and {paths.length - 12} more</li>}
              </ul>
            </div>
          ) : (
            <div className="alert alert-info mt-4 items-start text-sm" role="status">
              <i className="ph ph-folder-open text-lg" aria-hidden="true"></i>
              <span>No resource folder selected.</span>
            </div>
          )}
        </fieldset>

        {review && review.description && files.length > 0 && (
          <fieldset className="fieldset rounded-box border border-base-300 bg-base-200/30 p-4 sm:p-5">
            <legend className="fieldset-legend px-2 text-base font-semibold">Description</legend>
            <p className="text-sm text-base-content/60">Inferred from the resource files. Edit it before submitting if needed.</p>
            <textarea className="textarea mt-2 min-h-28 w-full" rows={3} value={description} placeholder="Resource description" onInput={(event) => setDescription(event.currentTarget.value)} disabled={busy}></textarea>
          </fieldset>
        )}

        <div className="border-t border-base-300 pt-5">
          <div className="flex flex-wrap gap-3">
            <button className={'btn ' + (review ? 'btn-outline' : 'btn-primary')} type="submit" disabled={busy}>
              {busy && <span className="loading loading-spinner loading-sm" aria-hidden="true"></span>}
              Validate resource
            </button>
            {review && (
              <button className="btn btn-primary" type="button" onClick={() => void submitResource()} disabled={busy || !validated}>
                {busy && <span className="loading loading-spinner loading-sm" aria-hidden="true"></span>}
                Submit pull request
              </button>
            )}
          </div>
          <div className={'alert mt-4 items-start text-sm ' + (error ? 'alert-error' : 'alert-info')} role="status" aria-live="polite">
            <i className={'text-lg ' + (error ? 'ph ph-warning-circle' : 'ph ph-info')} aria-hidden="true"></i>
            <span>{status}</span>
          </div>
        </div>
      </form>

      {review && (
        <section className="card card-border mt-8 bg-base-200/30" aria-labelledby="publish-review-title">
          <div className="card-body p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 id="publish-review-title" className="text-lg font-semibold tracking-tight text-base-content">Ready to submit</h3>
                <p className="mt-1 text-sm text-base-content/60">Check these details before creating the pull request.</p>
              </div>
              <span className="badge badge-success">Validated</span>
            </div>
            <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium text-base-content/60">Resource</dt>
                <dd className="mt-1 break-all font-mono text-xs text-base-content">{review.resource || composedId}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-base-content/60">Version</dt>
                <dd className="mt-1 text-base-content">{review.version}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-base-content/60">Entry file</dt>
                <dd className="mt-1 break-all font-mono text-xs text-base-content">{review.entryFile}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-base-content/60">Files</dt>
                <dd className="mt-1 text-base-content">{review.files.length} file{review.files.length === 1 ? '' : 's'}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium text-base-content/60">Description</dt>
                <dd className="mt-1 leading-6 text-base-content">{reviewDescription}</dd>
              </div>
            </dl>
            <p className="mt-6 text-sm leading-6 text-base-content/60">The pull request stays unreviewed until the curation team reviews and merges it.</p>
            {pullRequestUrl && (
              <div className="alert alert-success mt-4 items-start text-sm">
                <i className="ph ph-check-circle text-lg" aria-hidden="true"></i>
                <a className="link link-hover font-semibold" href={pullRequestUrl} target="_blank" rel="noreferrer">Open pull request</a>
              </div>
            )}
          </div>
        </section>
      )}
    </section>
  );

  return (
    <DrawerShell
      id={DRAWER_TOGGLES.publish}
      title="Publish resource"
      onOpen={() => closeDrawers(DRAWER_TOGGLES.changeDeck, DRAWER_TOGGLES.settings)}
    >
      {content}
    </DrawerShell>
  );
}
