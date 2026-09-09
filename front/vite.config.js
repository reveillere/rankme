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
