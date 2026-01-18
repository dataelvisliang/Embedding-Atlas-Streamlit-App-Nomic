import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Use "/" for Vercel, "/Embedding-Atlas-App-Nomic/" for GitHub Pages
  base: process.env.VERCEL ? "/" : "/Embedding-Atlas-App-Nomic/",
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  plugins: [react()],
  worker: {
    format: "es",
  },
  build: {
    target: "esnext",
  },
  optimizeDeps: {
    exclude: ["embedding-atlas", "@uwdata/mosaic-core", "@duckdb/duckdb-wasm"],
  },
})
