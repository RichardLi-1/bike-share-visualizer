// Draws and encodes the greyscale video. The preview and the export both call
// drawFrame, so the page shows exactly what the file will contain.
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output } from 'mediabunny'
import { Map as MapLibre } from 'maplibre-gl'
import './maplibre'
import { DATA_URL, loadDay } from './data'
import { formatClock } from './time'

export const WIDTH = 1920
export const HEIGHT = 1080
export const FPS = 30
const BITRATE = 16_000_000

const BASEMAP = 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json'

export type Layout = {
  file: string
  panels: { url: string; label?: string }[]
  center: [number, number]
  zoom: number
  lineWidth: number
}

export const SINGLE: Layout = {
  file: 'bike-share-rides-2026-08-13.mp4',
  panels: [{ url: DATA_URL }],
  center: [-79.395, 43.66],
  zoom: 12.15,
  lineWidth: 1.6,
}

// Both years share one map, scale and clock, so only the ridership differs.
export const COMPARE: Layout = {
  file: 'bike-share-rides-2017-vs-2026.mp4',
  panels: [
    { url: '/data/day-2017-08-10.json', label: '2017' },
    { url: DATA_URL, label: '2026' },
  ],
  center: [-79.385, 43.66],
  zoom: 11.72,
  lineWidth: 1.3,
}
const BEARING = -17

const DAY_SECONDS = 24 * 3600
// The loop joins at the quietest time of day, so the restart is hard to see.
const LOOP_START = 4 * 3600
// About 66 simulated seconds per frame, or 33 minutes of the day per second at 30 fps.
export const FRAME_COUNT = 1309
const SECONDS_PER_FRAME = DAY_SECONDS / FRAME_COUNT

// Tails shorten towards downtown so rides stay distinct where they concentrate.
const TRAIL_SECONDS = 600
const DOWNTOWN_TRAIL_SECONDS = 150
const DOWNTOWN = [-79.39, 43.655] as [number, number]
// Sizes at zoom 12.15; other zooms scale them to cover the same ground.
const DOWNTOWN_INNER_PX = 280
const DOWNTOWN_OUTER_PX = 560
// Trail opacity from its oldest slice to its newest.
const TRAIL_FADE = [0.06, 0.12, 0.2, 0.32, 0.5, 0.85]

type Ride = { xy: Float32Array; times: Float32Array; start: number; end: number }

export type Scene = {
  layout: Layout
  base: HTMLCanvasElement
  panels: { label?: string; rides: Ride[] }[]
  downtown: [number, number]
}

async function renderBasemap({ center, zoom, panels }: Layout) {
  const width = WIDTH / panels.length
  const host = document.createElement('div')
  host.style.cssText = `position:fixed;left:-${WIDTH * 2}px;top:0;width:${width}px;height:${HEIGHT}px`
  document.body.append(host)
  const map = new MapLibre({
    container: host,
    style: BASEMAP,
    center,
    zoom,
    bearing: BEARING,
    pixelRatio: 1,
    interactive: false,
    attributionControl: false,
    fadeDuration: 0,
    canvasContextAttributes: { preserveDrawingBuffer: true },
  })
  await new Promise((resolve, reject) => {
    map.once('idle', resolve)
    map.once('error', (e) => reject(e.error))
  })

  const base = document.createElement('canvas')
  base.width = width
  base.height = HEIGHT
  const ctx = base.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(map.getCanvas(), 0, 0, width, HEIGHT)
  const image = ctx.getImageData(0, 0, width, HEIGHT)
  const px = image.data
  for (let i = 0; i < px.length; i += 4) {
    px[i] = px[i + 1] = px[i + 2] = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]
  }
  ctx.putImageData(image, 0, 0)
  return { map, host, base }
}

export async function buildScene(layout: Layout): Promise<Scene> {
  const days = await Promise.all(layout.panels.map((p) => loadDay(p.url)))
  const { map, host, base } = await renderBasemap(layout)
  const panels = days.map((day, i) => {
    // Trips share route arrays, so project each route once.
    const projected = new Map<number[], Float32Array>()
    const rides = day.trips.map((trip) => {
      let xy = projected.get(trip.path)
      if (!xy) {
        xy = new Float32Array(trip.path.length)
        for (let j = 0; j < xy.length; j += 2) {
          const p = map.project([trip.path[j], trip.path[j + 1]])
          xy[j] = p.x
          xy[j + 1] = p.y
        }
        projected.set(trip.path, xy)
      }
      return { xy, times: trip.timestamps, start: trip.start, end: trip.end }
    })
    return { label: layout.panels[i].label, rides }
  })
  const { x, y } = map.project(DOWNTOWN)
  map.remove()
  host.remove()
  return { layout, base, panels, downtown: [x, y] }
}

/** Canvas text has no tabular numerals, so each digit gets a fixed-width cell to stop the clock jittering. */
function drawClock(ctx: CanvasRenderingContext2D, text: string, x: number, y: number) {
  const digit = Math.max(...[...'0123456789'].map((d) => ctx.measureText(d).width))
  ctx.textAlign = 'center'
  for (const char of text) {
    const width = char === ':' ? ctx.measureText(char).width : digit
    ctx.fillText(char, x + width / 2, y)
    x += width
  }
  ctx.textAlign = 'start'
}

function pointAt({ xy, times }: Ride, i: number, t: number): [number, number] {
  const f = (t - times[i - 1]) / (times[i] - times[i - 1])
  const x = xy[2 * i - 2]
  const y = xy[2 * i - 1]
  return [x + (xy[2 * i] - x) * f, y + (xy[2 * i + 1] - y) * f]
}

/** Index of the first vertex after time t. */
function vertexAfter({ times }: Ride, t: number) {
  let i = 1
  while (i < times.length - 1 && times[i] <= t) i++
  return i
}

/** Adds the part of a ride between two times to the current path. */
function traceRide(ctx: CanvasRenderingContext2D, ride: Ride, from: number, to: number) {
  let i = vertexAfter(ride, from)
  ctx.moveTo(...pointAt(ride, i, from))
  for (; ride.times[i] < to; i++) ctx.lineTo(ride.xy[2 * i], ride.xy[2 * i + 1])
  ctx.lineTo(...pointAt(ride, i, to))
}

function trailSeconds(scene: Scene, ride: Ride, now: number) {
  const head = Math.min(now, ride.end)
  const [x, y] = pointAt(ride, vertexAfter(ride, head), head)
  const distance = Math.hypot(x - scene.downtown[0], y - scene.downtown[1])
  const scale = 2 ** (scene.layout.zoom - 12.15)
  const inner = DOWNTOWN_INNER_PX * scale
  const f = Math.min(Math.max((distance - inner) / (DOWNTOWN_OUTER_PX * scale - inner), 0), 1)
  return DOWNTOWN_TRAIL_SECONDS + (TRAIL_SECONDS - DOWNTOWN_TRAIL_SECONDS) * f * f * (3 - 2 * f)
}

function drawRides(ctx: CanvasRenderingContext2D, scene: Scene, rides: Ride[], time: number) {
  // Additive strokes make busy corridors glow brighter than quiet streets.
  ctx.globalCompositeOperation = 'lighter'
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = scene.layout.lineWidth
  ctx.lineJoin = 'round'
  // The second pass replays the early hours after midnight to close the loop.
  for (const dayStart of [0, DAY_SECONDS]) {
    const now = time - dayStart
    for (const ride of rides) {
      if (ride.start >= now || ride.end <= now - TRAIL_SECONDS) continue
      const trail = trailSeconds(scene, ride, now)
      const slice = trail / TRAIL_FADE.length
      TRAIL_FADE.forEach((alpha, i) => {
        const sliceStart = now - trail + i * slice
        const from = Math.max(sliceStart, ride.start)
        const to = Math.min(sliceStart + slice, ride.end)
        if (from >= to) return
        ctx.globalAlpha = alpha
        ctx.beginPath()
        traceRide(ctx, ride, from, to)
        ctx.stroke()
      })
    }
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
}

export function drawFrame(ctx: CanvasRenderingContext2D, scene: Scene, frame: number) {
  const time = LOOP_START + frame * SECONDS_PER_FRAME
  const width = WIDTH / scene.panels.length
  const font = (css: string) => `${css} Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
  ctx.fillStyle = '#fff'
  ctx.textBaseline = 'alphabetic'

  scene.panels.forEach(({ label, rides }, i) => {
    ctx.save()
    ctx.beginPath()
    ctx.rect(i * width, 0, width, HEIGHT)
    ctx.clip()
    ctx.translate(i * width, 0)
    ctx.drawImage(scene.base, 0, 0)
    drawRides(ctx, scene, rides, time)
    if (label) {
      ctx.font = font('600 52px')
      ctx.fillText(label, 44, 84)
    }
    ctx.restore()
  })
  if (scene.panels.length > 1) {
    ctx.fillStyle = '#000'
    ctx.fillRect(width - 2, 0, 4, HEIGHT)
    ctx.fillStyle = '#fff'
  }

  ctx.font = font('600 76px')
  drawClock(ctx, formatClock(time), 48, HEIGHT - 92)
  ctx.font = font('400 32px')
  ctx.fillText('bike share rides', 50, HEIGHT - 46)
}

export async function encodeVideo(scene: Scene, onProgress: (done: number) => void) {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const ctx = canvas.getContext('2d')!
  const target = new BufferTarget()
  const output = new Output({ format: new Mp4OutputFormat(), target })
  const source = new CanvasSource(canvas, { codec: 'avc', bitrate: BITRATE })
  output.addVideoTrack(source, { frameRate: FPS })
  await output.start()

  for (let frame = 0; frame < FRAME_COUNT; frame++) {
    drawFrame(ctx, scene, frame)
    await source.add(frame / FPS, 1 / FPS)
    if (frame % 6 === 0) {
      onProgress(frame / FRAME_COUNT)
      await new Promise((resolve) => setTimeout(resolve))
    }
  }
  await output.finalize()
  return new Blob([target.buffer!], { type: 'video/mp4' })
}
