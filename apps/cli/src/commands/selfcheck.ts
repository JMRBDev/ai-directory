import { defineCommand } from 'citty';
import { version } from '../version';

export const selfcheck = defineCommand({
  meta: {
    name: '__selfcheck',
    description: 'Verify a staged AI Directory binary before it is activated (internal)',
    hidden: true,
  },
  args: {
    'expected-version': {
      type: 'string',
      description: 'Version the staged binary must report',
    },
  },
  run({ args }) {
    const expected = args['expected-version'];
    const ok = expected === undefined || version === expected;
    const payload = { ok, version, expectedVersion: expected ?? null };
    console.log(JSON.stringify(payload));
    if (!ok) process.exitCode = 1;
  },
});
