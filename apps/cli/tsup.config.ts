import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['cjs'],
  platform: 'node',
  target: 'node24',
  dts: false,
  sourcemap: true,
  outDir: 'dist',
  clean: true,
  banner: undefined,
  shims: true,
  outExtension: () => ({ js: '.cjs' }),
  esbuildOptions(options) {
    options.alias = {
      '@ai-directory/config': '../../packages/config/src/index.ts',
      '@ai-directory/contracts': '../../packages/contracts/src/index.ts',
      '@ai-directory/installers': '../../packages/installers/src/index.ts',
      '@ai-directory/registry': '../../packages/registry/src/index.ts',
      '@ai-directory/server-core': '../../packages/server-core/src/index.ts',
    };
  },
  noExternal: [
    '@ai-directory/config',
    '@ai-directory/contracts',
    '@ai-directory/installers',
    '@ai-directory/registry',
    '@ai-directory/server-core',
    'env-paths',
  ],
});
