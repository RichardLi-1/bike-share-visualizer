import { useEffect, useRef, useState } from 'react'
import {
  buildScene,
  CO2,
  COMPARE,
  drawFrame,
  encodeVideo,
  FPS,
  FRAME_COUNT,
  HEIGHT,
  PROMPTS,
  SINGLE,
  WIDTH,
  type Scene,
} from './videoFrames'
import './VideoApp.css'

// Started here, not in an effect, so StrictMode doesn't render the basemap twice.
const params = new URLSearchParams(window.location.search)
const layout = params.has('compare') ? COMPARE : params.has('co2') ? CO2 : params.has('prompts') ? PROMPTS : SINGLE
const scenePromise = buildScene(layout)

export default function VideoApp() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const raf = useRef(0)
  const [scene, setScene] = useState<Scene | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [savedSize, setSavedSize] = useState<number | null>(null)

  useEffect(() => {
    scenePromise.then(setScene, (e: Error) => setError(e.message))
  }, [])

  const exporting = progress !== null

  useEffect(() => {
    if (!scene || exporting) return
    const ctx = canvas.current!.getContext('2d')!
    const startedAt = performance.now()
    const tick = (now: number) => {
      drawFrame(ctx, scene, Math.floor(((now - startedAt) / 1000) * FPS) % FRAME_COUNT)
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [scene, exporting])

  const exportVideo = async () => {
    if (!scene) return
    setProgress(0)
    setSavedSize(null)
    setError(null)
    try {
      const blob = await encodeVideo(scene, setProgress)
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = scene.layout.file
      link.click()
      URL.revokeObjectURL(link.href)
      setSavedSize(blob.size)
    } catch (e) {
      setError((e as Error).message)
    }
    setProgress(null)
  }

  return (
    <main className="video-page">
      <canvas ref={canvas} width={WIDTH} height={HEIGHT} />
      <div className="video-bar">
        <button onClick={exportVideo} disabled={!scene || exporting}>
          {exporting ? `Exporting ${Math.round(progress * 100)}%` : 'Export video'}
        </button>
        <span>
          {error ??
            (!scene
              ? 'Loading map and rides…'
              : savedSize !== null
                ? `Saved, ${(savedSize / 1e6).toFixed(1)} MB`
                : `${WIDTH} × ${HEIGHT}, ${FPS} fps, ${Math.round(FRAME_COUNT / FPS)} s loop`)}
        </span>
        <small>Data: City of Toronto Open Data. Basemap © CARTO, © OpenStreetMap contributors.</small>
      </div>
    </main>
  )
}
