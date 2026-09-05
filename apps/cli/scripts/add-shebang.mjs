// tsup has no banner option in v8; prepend the node shebang by hand.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outFile = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'main.cjs');
const content = readFileSync(outFile, 'utf8');

if (!content.startsWith('#!/usr/bin/env node')) {
  writeFileSync(outFile, `#!/usr/bin/env node\n${content}`);
}
