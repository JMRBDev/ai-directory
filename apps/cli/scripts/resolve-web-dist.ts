import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(cliDir, '..', '..', '..');

function findWebDist(): string | undefined {
  const candidates = [
    process.env.AI_DIRECTORY_WEB_DIST,
    join(repoRoot, 'apps', 'web', 'dist'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => existsSync(join(candidate, 'index.html')));
}

const webDist = findWebDist();

if (!webDist) {
  console.error('Built website assets were not found. Run `pnpm --filter @ai-directory/web build` first.');
  process.exit(1);
}

console.log(webDist);
