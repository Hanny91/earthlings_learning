import { defineConfig } from 'vite';

// The app is served from earthlingslearning.co.uk/map/, so assets must resolve
// under /map/ and the build lands in the site's /map/ directory.
export default defineConfig({
  base: '/map/',
  build: {
    outDir: '../map',
    // outDir sits outside the Vite root, so clearing it must be opted into.
    emptyOutDir: true,
  },
});
