import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// open-licensed fonts (SIL OFL 1.1), bundled by Vite into /assets: same origin, nothing fetched elsewhere
import '@fontsource-variable/inter/wght.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
