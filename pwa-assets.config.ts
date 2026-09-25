// Generates the PWA icons in public/ from the SVG favicon: npx pwa-assets-generator
import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

const background = '#0f1216'

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background } },
  },
  images: ['public/favicon.svg'],
})
