// Copies root-level publish files into the CLI package directory so they
// land at the tarball root (package/README.md, package/LICENSE).
// pnpm pack only includes files under the package dir; parent-relative
// entries like ../../README.md are silently dropped.
import { copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(cliDir, '..', '..', '..');

copyFileSync(join(repoRoot, 'README.md'), join(cliDir, '..', 'README.md'));
copyFileSync(join(repoRoot, 'LICENSE'), join(cliDir, '..', 'LICENSE'));
console.log('Copied README.md and LICENSE into apps/cli');
