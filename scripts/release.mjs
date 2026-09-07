// One-command release: bump versions, verify, commit, tag, push.
// Usage: pnpm release [patch|minor|major] [--dry-run]
//
// - patch: 0.1.0 -> 0.1.1 (fixes, docs, packaging)
// - minor: 0.1.0 -> 0.2.0 (new features, backwards compatible)
// - major: 0.1.0 -> 1.0.0 (breaking changes)
// CI publishes to npm when the v* tag lands (trusted publishing, no tokens).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootPackagePath = join(repoRoot, 'package.json');
const cliPackagePath = join(repoRoot, 'apps', 'cli', 'package.json');
const REQUIRED_TARBALL_FILES = ['dist/main.cjs', 'dist/web/index.html', 'README.md', 'LICENSE'];

function run(command, args, options = {}) {
  const { stdio, ...rest } = options;
  // stdio:inherit streams to the terminal and yields no captured output.
  // Callers that pass it do not use the return value.
  if (stdio === 'inherit') {
    execFileSync(command, args, { cwd: repoRoot, encoding: 'utf8', stdio: 'inherit', ...rest });
    return '';
  }
  return execFileSync(command, args, { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe', ...rest }).trim();
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function bump(version, kind) {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    fail(`cannot bump non-semver version: ${version}`);
  }
  const [major, minor, patch] = parts;
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function main() {
  const rest = process.argv.slice(2);
  const dryRun = rest.includes('--dry-run');
  const kind = rest.find((arg) => !arg.startsWith('-')) ?? 'patch';

  if (!['patch', 'minor', 'major'].includes(kind)) {
    fail(`unknown release kind: ${kind}. Use patch, minor, or major.`);
  }

  const status = run('git', ['status', '--porcelain']);
  if (status) fail(`working tree is not clean:\n${status}\nCommit or stash first.`);

  const branch = run('git', ['branch', '--show-current']);
  if (branch !== 'main') fail(`releases run from main, not ${branch || '(detached)'}.`);

  const rootPackage = JSON.parse(readFileSync(rootPackagePath, 'utf8'));
  const cliPackage = JSON.parse(readFileSync(cliPackagePath, 'utf8'));

  if (rootPackage.version !== cliPackage.version) {
    fail(`version drift: root is ${rootPackage.version}, CLI is ${cliPackage.version}. Sync them first.`);
  }

  const next = bump(rootPackage.version, kind);
  const tag = `v${next}`;
  console.log(`${rootPackage.version} -> ${next} (${kind})${dryRun ? ' [dry run]' : ''}`);

  try {
    run('git', ['rev-parse', '--verify', `refs/tags/${tag}`], { stdio: 'pipe' });
    fail(`tag ${tag} already exists.`);
  } catch {
    // Tag is free; continue.
  }

  if (dryRun) {
    console.log(`Would write ${next} to package.json + apps/cli/package.json, run checks, commit, tag ${tag}, push.`);
    return;
  }

  for (const [path, pkg] of [[rootPackagePath, rootPackage], [cliPackagePath, cliPackage]]) {
    writeFileSync(path, `${JSON.stringify({ ...pkg, version: next }, null, 2)}\n`);
  }
  console.log('Versions written. Running typecheck...');

  run('pnpm', ['typecheck'], { stdio: 'inherit' });
  console.log('Building...');
  run('pnpm', ['build'], { stdio: 'inherit' });

  console.log('Checking tarball contents...');
  const listing = run('pnpm', ['--filter', '@jmrbdev/ai-directory', 'pack', '--dry-run']).split('\n');
  // pnpm prints the packed file list between the "Tarball Contents" and
  // "Tarball Details" markers.
  const start = listing.findIndex((line) => line.includes('Tarball Contents'));
  const end = listing.findIndex((line) => line.includes('Tarball Details'));
  const packed = new Set(listing.slice(start + 1, end < 0 ? undefined : end).map((line) => line.trim()).filter(Boolean));
  const missing = REQUIRED_TARBALL_FILES.filter((file) => !packed.has(file));
  if (missing.length > 0) fail(`tarball is missing: ${missing.join(', ')}`);
  console.log(`Tarball OK (${packed.size} files).`);

  console.log('Smoke test...');
  run('node', ['apps/cli/dist/main.cjs', '--help'], { stdio: 'pipe' });

  run('git', ['add', 'package.json', 'apps/cli/package.json']);
  run('git', ['commit', '-m', `chore(release): bump to ${next}`]);
  run('git', ['tag', tag]);
  run('git', ['push', 'origin', 'main']);
  run('git', ['push', 'origin', tag]);
  console.log(`Released ${tag}. Follow CI with: gh run watch`);
}

main();
