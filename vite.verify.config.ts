import { defineConfig } from 'vite'

/**
 * Bundles scripts/verify.ts for Node so the headless check runs the exact same
 * modules the app does (Node cannot resolve the app's extensionless imports).
 */
export default defineConfig({
  build: {
    ssr: 'scripts/verify.ts',
    outDir: 'node_modules/.verify',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
  },
})
