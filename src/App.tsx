import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DeckGL from '@deck.gl/react'
import { ScatterplotLayer } from '@deck.gl/layers'
import { TripsLayer } from '@deck.gl/geo-layers'
import type { MapViewState } from '@deck.gl/core'
import { Map } from 'react-map-gl/maplibre'
import './maplibre'
import { DATA_URL, loadDay, type Day, type Trip } from './data'
import { Timeline } from './Timeline'
import { formatClock } from './time'
import './App.css'

const BASEMAP = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
const DAY_SECONDS = 24 * 3600
const TRAIL_SECONDS = 240

// ?t=08:30 starts the clock at that time; ?paused starts paused.
const params = new URLSearchParams(window.location.search)
const START_TIME = (() => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(params.get('t') ?? '')
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 : 5 * 3600
})()
const START_PAUSED = params.has('paused')

const INITIAL_VIEW: MapViewState = {
  longitude: -79.392,
  latitude: 43.643,
  zoom: 12.3,
  pitch: 40,
  bearing: -17,
}

// Simulated seconds per real second.
const SPEEDS = [
  { label: '1 min/s', value: 60 },
  { label: '5 min/s', value: 300 },
  { label: '15 min/s', value: 900 },
]

type ColorBy = 'rider' | 'bike'

const COLORS = {
  member: [64, 196, 255],
  casual: [255, 140, 66],
  classic: [120, 140, 255],
  ebike: [180, 255, 90],
} satisfies Record<string, [number, number, number]>

function tripColor(t: Trip, by: ColorBy): [number, number, number] {
  if (by === 'rider') return t.casual ? COLORS.casual : COLORS.member
  return t.ebike ? COLORS.ebike : COLORS.classic
}

export default function App() {
  const [day, setDay] = useState<Day | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [time, setTime] = useState(START_TIME)
  const [playing, setPlaying] = useState(!START_PAUSED)
  const [speed, setSpeed] = useState(300)
  const [colorBy, setColorBy] = useState<ColorBy>('rider')
  const frame = useRef<number>(0)

  useEffect(() => {
    loadDay(DATA_URL).then(setDay, (e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    if (!playing || !day) return
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now
      setTime((t) => {
        const next = t + dt * speed
        return next > DAY_SECONDS + TRAIL_SECONDS ? 0 : next
      })
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame.current)
  }, [playing, speed, day])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault()
        setPlaying((p) => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onSeek = useCallback((s: number) => setTime(s), [])

  const counts = useMemo(() => {
    if (!day) return null
    const casual = day.trips.filter((t) => t.casual).length
    const ebike = day.trips.filter((t) => t.ebike).length
    return { total: day.trips.length, casual, member: day.trips.length - casual, ebike, classic: day.trips.length - ebike }
  }, [day])

  const peak = useMemo(() => {
    if (!day) return null
    let minute = 0
    day.activeByMinute.forEach((v, m) => {
      if (v > day.activeByMinute[minute]) minute = m
    })
    return { minute, moving: day.activeByMinute[minute] }
  }, [day])

  const minute = Math.min(Math.floor(time / 60), 24 * 60 - 1)
  const movingNow = day ? day.activeByMinute[minute] : 0

  const layers = day
    ? [
        new ScatterplotLayer<Day['stations'][number]>({
          id: 'stations',
          data: day.stations,
          getPosition: (d) => [d[0], d[1]],
          getRadius: (d) => 8 + Math.sqrt(d[2]) * 2.2,
          radiusUnits: 'meters',
          radiusMinPixels: 1,
          getFillColor: [150, 160, 180, 70],
        }),
        new TripsLayer<Trip>({
          id: 'trips',
          data: day.trips,
          positionFormat: 'XY',
          getPath: (d) => d.path,
          getTimestamps: (d) => d.timestamps,
          getColor: (d) => tripColor(d, colorBy),
          updateTriggers: { getColor: colorBy },
          currentTime: time,
          trailLength: TRAIL_SECONDS,
          fadeTrail: true,
          widthMinPixels: 2,
          capRounded: true,
          jointRounded: true,
          opacity: 0.85,
        }),
      ]
    : []

  const legend =
    counts &&
    (colorBy === 'rider'
      ? [
          { color: COLORS.member, label: 'Member', n: counts.member },
          { color: COLORS.casual, label: 'Casual', n: counts.casual },
        ]
      : [
          { color: COLORS.classic, label: 'Classic bike', n: counts.classic },
          { color: COLORS.ebike, label: 'E-bike', n: counts.ebike },
        ])

  const dateLabel = day
    ? new Date(`${day.date}T12:00:00`).toLocaleDateString('en-CA', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : ''

  return (
    <div className="app">
      <DeckGL initialViewState={INITIAL_VIEW} controller layers={layers}>
        {/* Attribution is in the footnote; the default control sits under the panel. */}
        <Map mapStyle={BASEMAP} attributionControl={false} />
      </DeckGL>

      <header className="panel title">
        <h1>A day of Bike Share Toronto</h1>
        <p>{dateLabel}</p>
        {counts && <p className="muted">{counts.total.toLocaleString('en-US')} trips between stations</p>}
      </header>

      {!day && <div className="panel loading">{error ?? 'Loading trips…'}</div>}

      {day && (
        <footer className="panel controls">
          <div className="readout">
            <div className="clock">{formatClock(time)}</div>
            <div className="moving">
              <strong>{movingNow.toLocaleString('en-US')}</strong> bikes moving
            </div>
            {peak && (
              <div className="peak muted">
                Peak {peak.moving.toLocaleString('en-US')} at {formatClock(peak.minute * 60)}
              </div>
            )}
          </div>

          <div className="buttons">
            <button className="play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? '❚❚' : '▶'}
            </button>
            <div className="segmented" role="group" aria-label="Speed">
              {SPEEDS.map((s) => (
                <button key={s.value} className={s.value === speed ? 'on' : ''} onClick={() => setSpeed(s.value)}>
                  {s.label}
                </button>
              ))}
            </div>
            <div className="segmented" role="group" aria-label="Color by">
              <button className={colorBy === 'rider' ? 'on' : ''} onClick={() => setColorBy('rider')}>
                Rider type
              </button>
              <button className={colorBy === 'bike' ? 'on' : ''} onClick={() => setColorBy('bike')}>
                Bike type
              </button>
            </div>
            <ul className="legend">
              {legend?.map((l) => (
                <li key={l.label}>
                  <i style={{ background: `rgb(${l.color.join(',')})` }} />
                  {l.label} <span className="muted">{Math.round((l.n / counts!.total) * 100)}%</span>
                </li>
              ))}
            </ul>
          </div>

          <Timeline activeByMinute={day.activeByMinute} time={time} onSeek={onSeek} />

          <p className="footnote">
            Routes are estimated shortest bike paths between stations, not GPS tracks.{' '}
            {day.stats.roundTripsSkipped.toLocaleString('en-US')} round trips,{' '}
            {day.stats.noLocationSkipped.toLocaleString('en-US')} trips at stations missing from the live feed and{' '}
            {(day.stats.ferrySkipped ?? 0).toLocaleString('en-US')} trips between the mainland and the Toronto Islands
            (by ferry) are not
            shown. Data: City of Toronto Open Data, Bike Share Toronto ridership. Basemap © CARTO, © OpenStreetMap
            contributors.
          </p>
        </footer>
      )}
    </div>
  )
}
