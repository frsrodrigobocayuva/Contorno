// Testes ponta a ponta (plano, P12): o app de verdade, servido pela API do compose, num Chromium
// sem tela. O WebGL roda no SwiftShader, por software, para funcionar também no CI.
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  // Um cenário por vez: todos usam o mesmo GraphHopper, e dois cálculos restritos juntos chegam
  // a passar de 2 s cada um (S5-03).
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : 'line',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:8000',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--ignore-gpu-blocklist',
          ],
        },
      },
    },
  ],
})
