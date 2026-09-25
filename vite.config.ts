import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages serves the app from /<repo-name>/. The path is case-sensitive and
// must match the repo spelling exactly. Used in every mode so path bugs show up in dev.
export const BASE = '/Exersise-Applet/'

export default defineConfig({
  base: BASE,
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
