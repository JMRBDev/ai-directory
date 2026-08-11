#!/usr/bin/env bun

import { defineCommand, runMain } from 'citty';

const main = defineCommand({
  meta: {
    name: 'aid',
    version: '0.0.0',
    description: 'AI Directory CLI scaffold',
  },
  run() {
    console.log('AI Directory CLI scaffold. Commands will be added in vertical slices.');
  },
});

runMain(main);
