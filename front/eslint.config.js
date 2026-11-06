import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  { ignores: ['dist', 'playwright-report', 'test-results'] },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: '19.3' } },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      // Same two hooks rules as before; the React Compiler rules that the
      // plugin's recommended preset now adds are left off.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // This project doesn't use (or install) prop-types; the rule was
      // erroring on every component before lint had ever actually been run.
      'react/prop-types': 'off',
    },
  },
  {
    // Node-side files: the Playwright config and tests, and vite.config.js.
    files: ['e2e/**/*.js', 'playwright.config.js', 'vite.config.js'],
    languageOptions: { globals: globals.node },
  },
]
