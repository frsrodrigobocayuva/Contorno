import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Atkinson Hyperlegible (plano, D19), servida pelo próprio projeto: o Vite empacota os arquivos.
import '@fontsource/atkinson-hyperlegible/400.css'
import '@fontsource/atkinson-hyperlegible/700.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
