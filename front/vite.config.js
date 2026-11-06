import { defineConfig, transformWithOxc } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/',
  plugins: [
    {
      // The app keeps JSX in plain .js files, and Vite only parses JSX in
      // .jsx/.tsx. Compile the JSX in src/**/*.js first; the React plugin
      // then adds Fast Refresh on top in dev.
      name: 'treat-js-files-as-jsx',
      enforce: 'pre',
      async transform(code, id) {
        if (!/\/src\/.*\.js$/.test(id.split('?')[0])) return null;
        const result = await transformWithOxc(code, id, {
          lang: 'jsx',
          jsx: { runtime: 'automatic', development: this.environment?.mode === 'dev' },
          sourcemap: true,
        });
        return { code: result.code, map: result.map };
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
    include: [
      '@mui/material', '@mui/icons-material', '@emotion/react', '@emotion/styled',
      // Deep imports (e.g. `@mui/material/Tooltip`) are scanned by Vite as
      // their own separate optimize-deps entries regardless of the bare
      // '@mui/material' entry above -- if esbuild's chunk-splitting decides
      // one of those doesn't need its own `init_styled()` call (assuming,
      // wrongly in a multi-entry build, that some other already-loaded
      // entry already ran it), using styled_default() throws
      // "styled_default is not a function" at runtime. Listing the actual
      // deep-import paths the app uses (see `grep -rn "from '@mui/material/"
      // src`) explicitly here, alongside the bare package, is the
      // documented workaround.
      '@mui/material/Alert', '@mui/material/Box', '@mui/material/Button', '@mui/material/Card',
      '@mui/material/CardContent', '@mui/material/Checkbox', '@mui/material/Chip',
      '@mui/material/CircularProgress', '@mui/material/Dialog', '@mui/material/DialogActions',
      '@mui/material/DialogContent', '@mui/material/DialogTitle', '@mui/material/Divider',
      '@mui/material/FormControlLabel', '@mui/material/IconButton', '@mui/material/InputBase',
      '@mui/material/LinearProgress', '@mui/material/List', '@mui/material/ListItem',
      '@mui/material/ListItemButton', '@mui/material/ListItemText', '@mui/material/Paper',
      '@mui/material/Popover', '@mui/material/Snackbar', '@mui/material/Tab',
      '@mui/material/Table', '@mui/material/TableBody', '@mui/material/TableCell',
      '@mui/material/TableHead', '@mui/material/TableRow', '@mui/material/Tabs',
      '@mui/material/TextField', '@mui/material/ToggleButton', '@mui/material/ToggleButtonGroup',
      '@mui/material/Tooltip', '@mui/material/Typography',
    ],
    // Dependency scanning reads the app's .js files too, so they need the
    // same JSX treatment there.
    rolldownOptions: {
      moduleTypes: {
        '.js': 'jsx',
      },
    },
  },
  
  // Unit tests only; the Playwright suite in e2e/ runs separately (npm run e2e).
  test: {
    include: ['src/**/*.test.js'],
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
