// MapLibre finds its worker with a runtime-built URL that Vite can't see, so
// the worker is never emitted in the build. Import it as an asset instead.
import { setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import 'maplibre-gl/dist/maplibre-gl.css'

setWorkerUrl(workerUrl)
