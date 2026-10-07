import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// `base: './'` keeps asset URLs relative so the build works from any sub-path
// (e.g. GitHub Pages project sites).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    // The encoder chunks (Mediabunny + the AAC WASM build) are lazy-loaded on export.
    chunkSizeWarningLimit: 1100,
  },
  test: {
    environment: 'node',
  },
});
