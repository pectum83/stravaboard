import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  target: 'node22',
  clean: true,
  // Workspace package ships TS source; it must be bundled, not left as an import.
  noExternal: ['@stravaboard/shared'],
})
