import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import type { MultipartBody, MultipartValue } from './types.js';

export interface ResourceUpload {
  resourceId: string;
  version: string;
  description?: string;
  files: File[];
}

interface UploadResult {
  sourceDirectory: string;
  files: string[];
}

function uploadText(body: MultipartBody, key: string): string {
  const value = body[key];
  if (value === undefined || Array.isArray(value) || value instanceof File) return '';
  return value.trim();
}

function uploadFiles(value: MultipartValue): File[] {
  const values = Array.isArray(value) ? value : [value];
  return values.filter((item): item is File => item instanceof File);
}

type ResourceUploadResult = { ok: true; upload: ResourceUpload } | { ok: false; error: string };

export function parseResourceUpload(body: MultipartBody): ResourceUploadResult {
  const resourceId = uploadText(body, 'resourceId');
  const version = uploadText(body, 'version');
  const description = uploadText(body, 'description');
  const files = uploadFiles(body['files[]'] ?? body.files ?? []);

  if (!resourceId) return { ok: false, error: 'resourceId must be a non-empty string.' };
  if (!version) return { ok: false, error: 'version must be a non-empty string.' };
  if (files.length === 0) return { ok: false, error: 'files must include a resource directory.' };

  const upload: ResourceUpload = { resourceId, version, files };
  if (description) upload.description = description;

  return { ok: true, upload };
}

function uploadPath(file: File): string[] {
  const name = file.name.replaceAll('\\', '/');
  if (name.startsWith('/')) throw new Error(`Uploaded file path must be relative: ${file.name}`);

  const parts = name.split('/').filter((part) => part && part !== '.');
  if (parts.length === 0 || parts.some((part) => part === '..')) {
    throw new Error(`Invalid uploaded file path: ${file.name}`);
  }

  return parts;
}

async function writeUpload(files: File[]): Promise<UploadResult> {
  const sourceDirectory = await mkdtemp(join(tmpdir(), 'ai-directory-web-submit-'));
  const root = resolve(sourceDirectory);

  try {
    for (const file of files) {
      const parts = uploadPath(file);
      const destination = resolve(root, ...parts);

      if (destination !== root && !destination.startsWith(`${root}${sep}`)) {
        throw new Error(`Uploaded file path escapes the temporary directory: ${file.name}`);
      }

      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, Buffer.from(await file.arrayBuffer()));
    }

    return {
      sourceDirectory,
      files: files.map((file) => uploadPath(file).join('/')),
    };
  } catch (error) {
    await rm(sourceDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function withResourceUpload<T>(
  upload: ResourceUpload,
  action: (sourceDirectory: string) => Promise<T>,
): Promise<T> {
  const written = await writeUpload(upload.files);

  try {
    return await action(written.sourceDirectory);
  } finally {
    await rm(written.sourceDirectory, { recursive: true, force: true });
  }
}
