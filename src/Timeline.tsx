import { useMemo, useRef } from 'react'
import { MINUTES } from './data'

const H = 56

type Props = {
  activeByMinute: Int32Array
  time: number
  onSeek: (seconds: number) => void
}

/** Area chart of trips in motion across the day; click or drag to scrub. */
export function Timeline({ activeByMinute, time, onSeek }: Props) {
  const ref = useRef<SVGSVGElement>(null)
  const dragging = useRef(false)

  const area = useMemo(() => {
    const peak = Math.max(...activeByMinute)
    const y = (v: number) => H - (v / (peak || 1)) * (H - 6)
    let d = `M0,${H}`
    activeByMinute.forEach((v, m) => (d += `L${m},${y(v).toFixed(1)}`))
    d += `L${MINUTES},${H}Z`
    return d
  }, [activeByMinute])

  const seek = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect()
    const f = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1)
    onSeek(f * MINUTES * 60)
  }

  const cursor = Math.min(time / 60, MINUTES)

  return (
    <div className="timeline">
      <svg
        ref={ref}
        viewBox={`0 0 ${MINUTES} ${H}`}
        preserveAspectRatio="none"
        role="slider"
        aria-label="Time of day"
        aria-valuemin={0}
        aria-valuemax={MINUTES * 60}
        aria-valuenow={Math.round(time)}
        onPointerDown={(e) => {
          dragging.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          seek(e.clientX)
        }}
        onPointerMove={(e) => dragging.current && seek(e.clientX)}
        onPointerUp={() => (dragging.current = false)}
      >
        <path d={area} className="timeline-area" />
        <rect x={0} y={0} width={cursor} height={H} className="timeline-past" />
        <line x1={cursor} x2={cursor} y1={0} y2={H} className="timeline-cursor" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="timeline-axis">
        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
          <span key={h} style={{ left: `${(h / 24) * 100}%` }}>
            {h === 24 ? '' : `${String(h).padStart(2, '0')}:00`}
          </span>
        ))}
      </div>
    </div>
  )
}
