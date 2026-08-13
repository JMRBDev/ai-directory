import { useState } from 'preact/hooks';
import { useMountEffect } from './useMountEffect';

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

type ApiResult = {
  error?: string;
  username?: string;
  pullRequestUrl?: string;
  resource?: string;
  version?: string;
  entryFile?: string;
  files?: unknown;
  description?: string;
};

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
  const [status, setStatus] = useState('Loading GitHub username…');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pullRequestUrl, setPullRequestUrl] = useState('');

  useMountEffect(() => {
    void loadGithubUsername();
  });

  function showStatus(message: string, isError = false) {
    setStatus(message);
    setError(isError);
  }

  async function loadGithubUsername() {
    try {
      const response = await fetch(apiUrl + '/api/github-user');
      const result = await response.json() as ApiResult;
      if (!response.ok || typeof result.username !== 'string') {
        throw new Error(result.error ?? 'Could not determine the GitHub username.');
      }
      setOwner(result.username);
      showStatus('Ready to validate.');
    } catch (cause) {
      showStatus(cause instanceof Error ? cause.message : 'Could not determine the GitHub username.', true);
    }
  }

  function resetValidation() {
    setValidated(false);
    setReview(null);
    setPullRequestUrl('');
  }

  function onFilesChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
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

  async function request(path: string) {
    const response = await fetch(apiUrl + path, {
      method: 'POST',
      body: formData(),
    });
    const result = await response.json().catch(() => ({})) as ApiResult;
    if (!response.ok) throw new Error(result.error ?? 'The local API request failed.');
    return result;
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
      const result = await request('/api/validate');
      const reviewFiles = Array.isArray(result.files)
        ? result.files.filter((file): file is string => typeof file === 'string')
        : [];
      const nextReview = {
        resource: String(result.resource ?? [owner, type, name].join('/')),
        version: String(result.version ?? version),
        entryFile: String(result.entryFile ?? 'Not found'),
        files: reviewFiles,
        description: typeof result.description === 'string' ? result.description.trim() : '',
      };
      setReview(nextReview);
      setDescription(nextReview.description);
      setValidated(true);
      showStatus('Validation passed. Review the files, then submit the pull request.');
    } catch (cause) {
      showStatus(cause instanceof Error ? cause.message : 'Could not validate the resource.', true);
    } finally {
      setBusy(false);
    }
  }

  async function submitResource() {
    if (!validated || !window.confirm('Create this pull request?')) return;

    setBusy(true);
    showStatus('Creating pull request…');
    try {
      const result = await request('/api/submit');
      const url = typeof result.pullRequestUrl === 'string' ? result.pullRequestUrl : '';
      setPullRequestUrl(url);
      setValidated(false);
      showStatus(url ? 'Pull request created: ' + url : 'Pull request created.');
    } catch (cause) {
      showStatus(cause instanceof Error ? cause.message : 'Could not create the pull request.', true);
    } finally {
      setBusy(false);
    }
  }

  const paths = files.map(pathFor).sort();
  const folder = files[0]?.webkitRelativePath?.split('/')[0];
  const reviewDescription = description.trim() || 'Not found';
  const composedId = [owner, type, name].join('/');

  return (
    <section className="mt-12 w-full" aria-labelledby="publish-title">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-base-300 pb-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Pull request</p>
          <h2 id="publish-title" className="mt-2 text-xl font-semibold tracking-tight text-base-content">Resource details</h2>
        </div>
        <span className="badge badge-ghost">Local API</span>
      </div>

      <form className="mt-6 space-y-6" onSubmit={(event) => void validateResource(event)}>
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_10rem]">
          <fieldset className="fieldset rounded-box border border-base-300 p-4">
            <legend className="fieldset-legend">Resource ID</legend>
            <div className="join join-vertical w-full sm:join-horizontal">
              <label className="fieldset">
                <span className="fieldset-legend text-xs">GitHub user</span>
                <input className="input input-bordered join-item w-full" type="text" value={owner} placeholder="Loading…" disabled />
              </label>
              <label className="fieldset">
                <span className="fieldset-legend text-xs">Type</span>
                <select className="select select-bordered join-item w-full" value={type} onChange={(event) => { setType(event.currentTarget.value); resetValidation(); }} required disabled={busy}>
                  <option value="skills">Skill</option>
                  <option value="agents">Agent</option>
                  <option value="rules">Rule</option>
                  <option value="templates">Template</option>
                </select>
              </label>
              <label className="fieldset">
                <span className="fieldset-legend text-xs">Name</span>
                <input className="input input-bordered join-item w-full" type="text" value={name} placeholder="my-resource" onInput={(event) => { setName(event.currentTarget.value); resetValidation(); }} autoComplete="off" required disabled={busy} />
              </label>
            </div>
          </fieldset>
          <label className="fieldset">
            <span className="fieldset-legend">Version</span>
            <input className="input input-bordered w-full" type="text" value={version} onInput={(event) => { setVersion(event.currentTarget.value); resetValidation(); }} autoComplete="off" required disabled={busy} />
          </label>
        </div>

        <label className="card cursor-pointer border border-dashed border-base-300 bg-base-100 transition-colors hover:border-primary">
          <div className="card-body p-5">
            <span className="text-sm font-semibold text-base-content">Resource directory</span>
            <span className="mt-1 text-sm text-base-content/60">Choose the folder that contains the resource files.</span>
            <input className="file-input file-input-bordered mt-4 w-full" type="file" multiple required ref={(element) => element?.setAttribute('webkitdirectory', '')} onChange={onFilesChange} disabled={busy} />
            <span className="mt-3 text-xs text-base-content/60">
              {paths.length > 0 ? 'Selected folder: ' + (folder ?? 'resource files') : 'Select a folder containing the resource files.'}
            </span>
          </div>
        </label>

        <div className="card card-border bg-base-100" aria-live="polite">
          <div className="card-body p-4">
            <strong className="text-sm font-semibold text-base-content">
              {paths.length === 0 ? 'No files selected' : paths.length + ' file' + (paths.length === 1 ? '' : 's') + ' selected'}
            </strong>
            <ul className="list list-sm mt-3 max-h-40 overflow-y-auto font-mono text-xs text-base-content/60">
              {paths.slice(0, 12).map((path) => <li className="list-row py-1" key={path}>{path}</li>)}
              {paths.length > 12 && <li className="list-row py-1">…and {paths.length - 12} more</li>}
            </ul>
          </div>
        </div>

        {review && review.description && files.length > 0 && (
          <div className="card card-border bg-base-100">
            <div className="card-body p-4">
              <label className="fieldset">
                <span className="fieldset-legend">Description</span>
                <textarea className="textarea textarea-bordered min-h-24 w-full" rows={3} value={description} placeholder="The resource description will appear here after validation." onInput={(event) => setDescription(event.currentTarget.value)} disabled={busy}></textarea>
              </label>
              <span className="mt-2 text-xs text-base-content/60">Inferred from the resource files. Edit if needed.</span>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <button className="btn btn-primary" type="submit" disabled={busy}>Validate resource</button>
          {review && (
            <button className="btn btn-outline" type="button" onClick={() => void submitResource()} disabled={busy || !validated}>
              Submit pull request
            </button>
          )}
        </div>
        <p className={'text-sm ' + (error ? 'text-error' : 'text-base-content/60')} role="status">{status}</p>
      </form>

      {review && (
        <div className="card card-border mt-10 bg-base-100">
          <div className="card-body p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Review</p>
            <h2 className="mt-2 text-lg font-semibold tracking-tight text-base-content">Ready to submit</h2>
            <ul className="list list-sm mt-5 text-sm sm:grid sm:grid-cols-2">
              <li className="list-row list-col-wrap border-t border-base-300"><span className="text-xs font-semibold text-base-content/60">Resource</span><code className="list-col-grow break-all font-mono text-xs text-base-content">{review.resource || composedId}</code></li>
              <li className="list-row list-col-wrap border-t border-base-300"><span className="text-xs font-semibold text-base-content/60">Version</span><span className="list-col-grow text-base-content">{review.version}</span></li>
              <li className="list-row list-col-wrap border-t border-base-300"><span className="text-xs font-semibold text-base-content/60">Entry file</span><code className="list-col-grow font-mono text-xs text-base-content">{review.entryFile}</code></li>
              <li className="list-row list-col-wrap border-t border-base-300"><span className="text-xs font-semibold text-base-content/60">Files</span><span className="list-col-grow text-base-content">{review.files.length} file{review.files.length === 1 ? '' : 's'}</span></li>
              <li className="list-row list-col-wrap border-t border-base-300 sm:col-span-2"><span className="text-xs font-semibold text-base-content/60">Description</span><span className="list-col-grow leading-6 text-base-content">{reviewDescription}</span></li>
            </ul>
            <p className="mt-5 text-sm leading-6 text-base-content/60">The pull request will be unreviewed until the curation team reviews and merges it.</p>
            {pullRequestUrl && <a className="link link-primary mt-4 text-sm font-semibold" href={pullRequestUrl} target="_blank" rel="noreferrer">Open pull request</a>}
          </div>
        </div>
      )}
    </section>
  );
}
