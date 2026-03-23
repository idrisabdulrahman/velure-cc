import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite-plus'
import tsconfigPaths from 'vite-tsconfig-paths'

const config = defineConfig({
  staged: {
    "*": "vp check --fix"
  },
  lint: {"options":{"typeAware":true,"typeCheck":true}},
  build: {
      chunkSizeWarningLimit: 1000, // raises the warning threshold to 1MB
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (
              id.includes('/react-dom/') ||
              id.includes('/react/') ||
              id.includes('/scheduler/')
            ) {
              return 'react-vendor'
            }

            if (
              id.includes('@react-pdf/') ||
              id.includes('/qrcode') ||
              id.includes('/fontkit') ||
              id.includes('/pdfkit')
            ) {
              return 'pdf-vendor'
            }

            if (id.includes('framer-motion')) {
              return 'motion-vendor'
            }
          }
        },
      },
    },
  },
  plugins: [
    nitro({ rollupConfig: { external: [/^@sentry\//] } }),
    tsconfigPaths({ projects: ['./tsconfig.json'] }),
    tailwindcss(),
    tanstackStart(),
    viteReact({
      babel: {
        plugins: ['babel-plugin-react-compiler'],
      },
    }),
  ],
})

export default config
