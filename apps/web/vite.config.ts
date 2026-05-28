import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Monorepo: always resolve react + react-dom from the hoisted root install.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const reactRoot = path.join(repoRoot, 'node_modules/react')
const reactDomRoot = path.join(repoRoot, 'node_modules/react-dom')

export default defineConfig({
  // Load VITE_* from monorepo root `.env` (not only apps/web).
  envDir: repoRoot,
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      react: reactRoot,
      'react-dom': reactDomRoot,
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime'],
  },
})
