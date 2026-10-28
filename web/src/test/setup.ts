import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Sem os globais do Vitest, o Testing Library não limpa a tela sozinho entre os testes.
afterEach(() => {
  cleanup()
})
