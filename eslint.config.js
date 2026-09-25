import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const DETERMINISM = [
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: 'Pass "now" in as a parameter; domain code must be deterministic.',
  },
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: 'Pass "now" in as a parameter; domain code must be deterministic.',
  },
  {
    selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
    message: 'Domain code must be deterministic.',
  },
]

export default defineConfig([
  globalIgnores(['dist', 'dev-dist', 'coverage', 'playwright-report', 'test-results', '.claude']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Pure layers: no React, Dexie, browser APIs or app layers; no implicit "now".
    files: ['src/domain/**/*.ts', 'src/seed/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'react',
                'react-*',
                'react/*',
                'dexie',
                'dexie-*',
                '@/db',
                '@/db/*',
                '@/services',
                '@/services/*',
                '@/features/*',
                '@/platform/*',
                '@/ui/*',
              ],
              message: 'domain/ and seed/ must stay pure (no React, Dexie or app layers).',
            },
          ],
        },
      ],
      'no-restricted-syntax': ['error', ...DETERMINISM],
    },
  },
  {
    // UI writes go through services/, never straight to repositories.
    files: ['src/features/**/*.{ts,tsx}', 'src/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/db/repos', '@/db/repos/*'],
              message: 'UI code writes through services/, not repositories.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['*.config.{js,ts}', 'tests/e2e/**/*.ts', 'scripts/**/*.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
])
