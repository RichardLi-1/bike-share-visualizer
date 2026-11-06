export function formatClock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds)) % (24 * 3600)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
