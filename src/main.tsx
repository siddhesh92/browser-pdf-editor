import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { useDoc } from './store/document'

// Dev-only handle so scripts/uitest.mjs can read real state while driving the
// app with native input. Never referenced by the app itself.
if (import.meta.env.DEV) {
  ;(window as unknown as { __store?: unknown }).__store = useDoc
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
