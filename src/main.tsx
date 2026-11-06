import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

// These open the greyscale video exporter instead of the interactive map.
const params = new URLSearchParams(window.location.search)
const isVideo = ['video', 'compare', 'co2', 'prompts'].some((name) => params.has(name))
const Page = lazy(() => (isVideo ? import('./VideoApp') : import('./App')))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense>
      <Page />
    </Suspense>
  </StrictMode>,
)
