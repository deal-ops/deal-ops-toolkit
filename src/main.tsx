import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// open-licensed fonts (SIL OFL 1.1), bundled by Vite into /assets: same origin, nothing fetched elsewhere
import '@fontsource-variable/inter/wght.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import './tokens.css'
import './index.css'
import App from './App.tsx'
import { applyTheme, loadTheme } from './theme'

// before the first render, so a stored Light or Dark choice does not flash the device theme first
try {
  applyTheme(loadTheme(window.localStorage))
} catch {
  // blocked storage: follow the device
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
