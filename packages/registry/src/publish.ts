import { basename, dirname, join, relative } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  detectResourceRoots,
  resourceIdSchema,
  resourceEntryFiles,
  resourceKey,
  resourceVersionSchema,
  type DetectedResource,
  type RegistryIndex,
  type ResourceSummary,
} from '@ai-directory/contracts';
import { listFilesUnder, pathExists } from '@ai-directory/config';
import { gt as isGreaterVersion, valid as isValidVersion } from 'semver';
import { inferResourceDescription } from './content.js';
import { readRegistryIndex, writeRegistryIndex } from './index-file.js';
import { parseResourceId, resolveDirectory, resourceDirectory } from './paths.js';
import { readMcpServerManifest, readPluginManifest, readTemplateManifest, readToolManifest } from './manifests.js';
import type {
  PublishResourceOptions,
  PublishResourceResult,
  ResourceDirectoryValidationOptions,
  ResourceDirectoryValidationResult,
  ResourceFile,
  ResourceVersion,
} from './types.js';

export async function publishResource(
  options: PublishResourceOptions,
): Promise<PublishResourceResult> {
  const validationOptions: ResourceDirectoryValidationOptions = {
    sourceDirectory: options.sourceDirectory,
    resourceId: options.resourceId,
    version: options.version,
  };
  if (options.description) validationOptions.description = options.description;

  const validation = await validateResourceDirectory(validationOptions);
  const identity = validation.resource;
  const description = validation.description;
  const index = await readRegistryIndex(options.indexPath);
  const current = index.resources.find((resource) => resourceKey(resource) === options.resourceId);

  if (current) {
    if (!isValidVersion(current.latestVersion)) {
      throw new Error(`Current resource version is invalid: ${current.latestVersion}`);
    }

    if (!isGreaterVersion(options.version, current.latestVersion)) {
      throw new Error(
        `Version must be greater than the current version ${current.latestVersion}: ${options.version}`,
      );
    }
  }

  const registryIndexPath = await resolveDirectory(options.indexPath, 'Registry index');
  const packageDirectory = resourceDirectory(
    dirname(registryIndexPath),
    identity,
    options.version,
  );

  if (await pathExists(packageDirectory)) {
    throw new Error(`Resource version already exists: ${options.resourceId}@${options.version}`);
  }

  await writeResourceFiles(packageDirectory, validation.files);

  const resource: ResourceSummary = current
    ? {
        ...current,
        description,
        latestVersion: options.version,
        reviewStatus: 'unreviewed',
        updatedAt: new Date().toISOString(),
      }
    : {
        ...identity,
        description,
        latestVersion: options.version,
        reviewStatus: 'unreviewed',
        lifecycleStatus: 'active',
        visibility: 'public',
        updatedAt: new Date().toISOString(),
      };

  const nextIndex: RegistryIndex = {
    ...index,
    resources: current
      ? index.resources.map((candidate) =>
          resourceKey(candidate) === options.resourceId ? resource : candidate,
        )
      : [...index.resources, resource],
  };

  await writeRegistryIndex(registryIndexPath, nextIndex);

  return {
    resource,
    packageDirectory,
    files: validation.files.map((file) => file.path),
  };
}

export async function validateResourceDirectory(
  options: ResourceDirectoryValidationOptions,
): Promise<ResourceDirectoryValidationResult> {
  if (!resourceIdSchema.safeParse(options.resourceId).success) {
    throw new Error(`Invalid resource ID: ${options.resourceId}`);
  }

  if (
    !resourceVersionSchema.safeParse(options.version).success ||
    !isValidVersion(options.version)
  ) {
    throw new Error(`Invalid resource version: ${options.version}`);
  }

  const resource = parseResourceId(options.resourceId);
  const sourceDirectory = await resolveDirectory(options.sourceDirectory, 'Resource source directory');
  const paths = await listFilesUnder(sourceDirectory);
  const files = await Promise.all(
    paths.map(async (path) => ({
      path: relative(sourceDirectory, path),
      content: await readFile(path, 'utf8'),
    })),
  );
  const entryFile = files.find((file) => resourceEntryFiles(resource.type).includes(file.path));

  if (!entryFile) {
    const expected = resourceEntryFiles(resource.type).join(' or ');
    const candidates = detectResourceRoots(files.map((file) => file.path), basename(sourceDirectory));
    const findings = candidates
      .map((candidate) => `${candidate.root || '.'} (${candidate.entryFile}, ${candidate.type})`)
      .join(', ');

    throw new Error(
      findings
        ? `${options.resourceId}@${options.version} is missing ${expected}. The folder contains other resources: ${findings}. Publish each one from its own folder.`
        : `${options.resourceId}@${options.version} is missing ${expected}`,
    );
  }

  if (!entryFile.content.trim()) {
    throw new Error(`${options.resourceId}@${options.version} has an empty ${entryFile.path}`);
  }

  const resourceVersion: ResourceVersion = {
    resource: {
      ...resource,
      description: 'Local resource validation',
      latestVersion: options.version,
      reviewStatus: 'unreviewed',
      lifecycleStatus: 'active',
      visibility: 'public',
      updatedAt: 'local',
    },
    version: options.version,
    files,
  };

  const description = options.description?.trim()
    || (resource.type === 'plugins'
      ? readPluginManifest(resourceVersion).manifest.description
      : resource.type === 'tools'
        ? readToolManifest(resourceVersion).description
        : inferResourceDescription(entryFile.content));
  if (!description) {
    throw new Error(
      `${options.resourceId}@${options.version} has no usable description. Add a description to ${entryFile.path} or pass one explicitly.`,
    );
  }

  if (resource.type === 'templates') {
    readTemplateManifest(resourceVersion);
  }

  if (resource.type === 'mcp-servers') {
    readMcpServerManifest(resourceVersion);
  }

  if (resource.type === 'plugins') {
    readPluginManifest(resourceVersion);
  }

  if (resource.type === 'tools') {
    readToolManifest(resourceVersion);
  }

  return { sourceDirectory, resource, entryFile, files, description };
}

export async function detectResourceCandidates(
  sourceDirectory: string,
): Promise<DetectedResource[]> {
  const resolved = await resolveDirectory(sourceDirectory, 'Resource source directory');
  const paths = await listFilesUnder(resolved);
  const relativePaths = paths.map((path) => relative(resolved, path));

  return detectResourceRoots(relativePaths, basename(resolved));
}

async function writeResourceFiles(directory: string, files: ResourceFile[]): Promise<void> {
  for (const file of files) {
    const destination = join(directory, file.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, file.content, 'utf8');
  }
}
