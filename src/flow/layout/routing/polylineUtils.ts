export type PolylinePoint = { x: number; y: number }

function norm(v: number): string {
  return (Math.round(v * 1000) / 1000).toFixed(3)
}

function pointKey(p: PolylinePoint): string {
  return `${norm(p.x)},${norm(p.y)}`
}

function dedupeAdjacent(points: PolylinePoint[]): PolylinePoint[] {
  if (points.length <= 1) return points
  const out: PolylinePoint[] = [points[0]]
  for (let i = 1; i < points.length; i += 1) {
    const prev = out[out.length - 1]
    const cur = points[i]
    if (Math.abs(prev.x - cur.x) < 1e-6 && Math.abs(prev.y - cur.y) < 1e-6) continue
    out.push(cur)
  }
  return out
}

export function buildPolylineSignature(points: PolylinePoint[]): string {
  const clean = dedupeAdjacent(points)
  if (clean.length <= 1) return ''
  const fwd = clean.map(pointKey).join('|')
  const rev = [...clean].reverse().map(pointKey).join('|')
  return fwd <= rev ? fwd : rev
}

