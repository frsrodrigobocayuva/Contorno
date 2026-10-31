import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'

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
    // Os ponta a ponta rodam no Playwright, contra o app de verdade (npm run e2e).
    exclude: [...configDefaults.exclude, 'e2e/**'],
    setupFiles: ['./src/test/setup.ts'],
  },
})
