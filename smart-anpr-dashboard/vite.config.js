import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/auth':       { target: 'http://localhost:8000', changeOrigin: true },
      '/users':      { target: 'http://localhost:8000', changeOrigin: true },
      '/cameras':    { target: 'http://localhost:8000', changeOrigin: true },
      '/camera':     { target: 'http://localhost:8000', changeOrigin: true },
      '/detections': { target: 'http://localhost:8000', changeOrigin: true },
      '/sessions':   { target: 'http://localhost:8000', changeOrigin: true },
      '/vehicles':   { target: 'http://localhost:8000', changeOrigin: true },
      '/analytics':  { target: 'http://localhost:8000', changeOrigin: true },
      '/alerts':     { target: 'http://localhost:8000', changeOrigin: true },
      '/anomalies':  { target: 'http://localhost:8000', changeOrigin: true },
      '/audit':      { target: 'http://localhost:8000', changeOrigin: true },
      '/me':         { target: 'http://localhost:8000', changeOrigin: true },
      '/health':     { target: 'http://localhost:8000', changeOrigin: true },
      '/reports/':   { target: 'http://localhost:8000', changeOrigin: true },
      '/admin/':     { target: 'http://localhost:8000', changeOrigin: true },
      '/search':     { target: 'http://localhost:8000', changeOrigin: true },
      '/static':     { target: 'http://localhost:8000', changeOrigin: true },
      '/ws':         { target: 'ws://localhost:8000', ws: true, changeOrigin: true },
    },
  },
})
