// Copies the built website into the CLI package so `aid web` works from npm.
// Expects `apps/web/dist/index.html` to exist (run the web build first).
import { cpSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(cliDir, '..', '..', '..');

function findWebDist() {
  const candidates = [
    process.env.AI_DIRECTORY_WEB_DIST,
    join(repoRoot, 'apps', 'web', 'dist'),
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(join(candidate, 'index.html')));
}

const webDist = findWebDist();

if (!webDist) {
  console.error('Built website assets were not found. Run `pnpm --filter @ai-directory/web build` first.');
  process.exit(1);
}

cpSync(webDist, join(cliDir, '..', 'dist', 'web'), { recursive: true });
console.log(`Copied website assets from ${webDist}`);
