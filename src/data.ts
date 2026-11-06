// Loads the file written by scripts/build_day.py and shapes it for deck.gl.

export type DayFile = {
  date: string
  stations: [lon: number, lat: number, departures: number][]
  routes: number[][]
  dists: number[][]
  trips: [route: number, startSec: number, endSec: number, isCasual: 0 | 1, isEbike: 0 | 1][]
  stats: {
    tripsInFile: number
    tripsShown: number
    roundTripsSkipped: number
    noLocationSkipped: number
    unroutedPairs: number
    ferrySkipped?: number
  }
}

export type Trip = {
  path: number[]
  timestamps: Float32Array
  start: number
  end: number
  metres: number
  casual: boolean
  ebike: boolean
}

export type Day = {
  date: string
  stations: DayFile['stations']
  trips: Trip[]
  /** Trips in motion at each minute of the day (index 0 = 00:00). */
  activeByMinute: Int32Array
  stats: DayFile['stats']
}

export const DATA_URL = '/data/day-2026-08-13.json'
export const MINUTES = 24 * 60

export async function loadDay(url: string): Promise<Day> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`)
  const file: DayFile = await res.json()

  const trips: Trip[] = file.trips.map(([r, start, end, casual, ebike]) => {
    const d = file.dists[r]
    const total = d[d.length - 1]
    const timestamps = new Float32Array(d.length)
    for (let i = 0; i < d.length; i++) {
      // Spread the trip's duration along the route in proportion to distance.
      const f = total > 0 ? d[i] / total : i / (d.length - 1)
      timestamps[i] = start + (end - start) * f
    }
    return { path: file.routes[r], timestamps, start, end, metres: total, casual: casual === 1, ebike: ebike === 1 }
  })

  const diff = new Int32Array(MINUTES + 1)
  for (const t of trips) {
    const s = Math.floor(t.start / 60)
    const e = Math.min(Math.floor(t.end / 60), MINUTES - 1)
    if (s >= MINUTES) continue
    diff[s]++
    diff[e + 1]--
  }
  const activeByMinute = new Int32Array(MINUTES)
  let running = 0
  for (let m = 0; m < MINUTES; m++) {
    running += diff[m]
    activeByMinute[m] = running
  }

  return { date: file.date, stations: file.stations, trips, activeByMinute, stats: file.stats }
}
