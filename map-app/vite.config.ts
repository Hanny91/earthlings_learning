import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The app is served from earthlingslearning.co.uk/map/, so assets must resolve
// under /map/ and the build lands in the site's /map/ directory.
export default defineConfig({
  base: '/map/',
  plugins: [react()],
  server: {
    fs: {
      // Setting `allow` replaces Vite's default, so the app's own root ('.') is
      // listed first. The second entry lets dev read the main site's images
      // (Logo.png) without exposing the rest of the repo. Paths are relative
      // to this folder.
      allow: ['.', '../assets/images'],
    },
  },
  build: {
    outDir: '../map',
    // outDir sits outside the Vite root, so clearing it must be opted into.
    emptyOutDir: true,
  },
});
