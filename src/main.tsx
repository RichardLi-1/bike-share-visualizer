import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

// ?video and ?compare open the greyscale video exporter instead of the interactive map.
const params = new URLSearchParams(window.location.search)
const Page = lazy(() => (params.has('video') || params.has('compare') ? import('./VideoApp') : import('./App')))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense>
      <Page />
    </Suspense>
  </StrictMode>,
)
