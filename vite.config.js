import { defineConfig, transformWithEsbuild } from 'vite'
import react from '@vitejs/plugin-react'

// console.log(import.meta.env);

export default defineConfig({
  base: '/',
  plugins: [
    {
      name: 'treat-js-files-as-jsx',
      async transform(code, id) {
        if (!id.match(/src\/.*\.js$/)) return null

        // Use the exposed transform from vite, instead of directly
        // transforming with esbuild
        return transformWithEsbuild(code, id, {
          loader: 'jsx',
          jsx: 'automatic',
        })
      },
    },
    react(),
  ],

  optimizeDeps: {
    force: true,
    esbuildOptions: {
      loader: {
        '.js': 'jsx',
      },
    },
  },

  resolve: {
    alias: {
      'string_decoder': 'string_decoder/',
      'buffer': 'buffer/'
    }
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor': ['react', 'react-dom', 'react-router-dom', 'chart.js', 'xml2js', 'react-datepicker', 'react-chartjs-2'],
          'mui' : ['@mui/material', '@mui/icons-material']
        }
      }
    }
  }

})