/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Em desenvolvimento, as chamadas à API vão para o contêiner da API (mesma origem em produção).
  server: {
    proxy: {
      '/health': 'http://localhost:8000',
      '/rotas': 'http://localhost:8000',
      '/restricoes': 'http://localhost:8000',
      '/enderecos': 'http://localhost:8000',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
