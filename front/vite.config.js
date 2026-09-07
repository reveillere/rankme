import { defineConfig, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/',
  plugins: [
    {
      name: 'treat-js-files-as-jsx',
      async transform(code, id) {
        if (!id.match(/src\/.*\.js$/)) return null;

        return transformWithEsbuild(code, id, {
          loader: 'jsx',
          jsx: 'automatic',
        });
      },
    },
    react(),
  ],

  optimizeDeps: {
    force: true,
    // Pins @mui/material + @emotion as single coherent pre-bundles instead
    // of letting esbuild discover them piecemeal through many separate
    // `@mui/material/X` deep imports — with enough deep imports discovered
    // in one optimize pass, esbuild's chunk-splitting can mis-wire the
    // shared `styled` export across chunks ("styled_default is not a
    // function" at runtime, from @mui/material/Popper and similar).
    include: ['@mui/material', '@mui/icons-material', '@emotion/react', '@emotion/styled'],
    esbuildOptions: {
      loader: {
        '.js': 'jsx',
      },
    },
  },
  
  server: {
    watch: {
      usePolling: true,
    },
    host: true,
    strictPort: true,
    port: 80,
  },
});
