import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      passWithNoTests: true,
      projects: [
        {
          extends: true,
          test: {
            name: 'domain',
            environment: 'node',
            include: ['src/domain/**/*.test.ts', 'src/seed/**/*.test.ts'],
          },
        },
        {
          extends: true,
          test: {
            name: 'db',
            environment: 'node',
            include: ['src/db/**/*.test.ts', 'src/services/**/*.test.ts'],
            setupFiles: ['./tests/setup/db.ts'],
          },
        },
        {
          extends: true,
          test: {
            name: 'ui',
            environment: 'happy-dom',
            include: [
              'src/**/*.test.tsx',
              'src/platform/**/*.test.ts',
              'src/ui/**/*.test.ts',
              'src/features/**/*.test.ts',
            ],
            setupFiles: ['./tests/setup/ui.ts'],
          },
        },
      ],
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.test.{ts,tsx}', 'src/main.tsx', 'src/sw.ts'],
      },
    },
  }),
)
