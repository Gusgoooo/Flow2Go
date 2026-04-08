import type { OcrBlock, RoleBlock } from './types'
import type { PptTextRole } from '../constants'

function bboxArea(b: [number, number, number, number]): number {
  return Math.max(0, b[2]) * Math.max(0, b[3])
}

export function inferRolesFromOcr(blocks: OcrBlock[]): RoleBlock[] {
  const cleaned = (Array.isArray(blocks) ? blocks : [])
    .map((b) => ({
      text: String(b.text ?? '').trim(),
      bbox: b.bbox,
    }))
    .filter((b) => b.text.length > 0 && Array.isArray(b.bbox) && b.bbox.length === 4)

  if (cleaned.length === 0) return []

  const sorted = [...cleaned].sort((a, b) => {
    // bigger height first, then higher on page
    const dh = (b.bbox[3] ?? 0) - (a.bbox[3] ?? 0)
    if (dh !== 0) return dh
    return (a.bbox[1] ?? 0) - (b.bbox[1] ?? 0)
  })

  const title = sorted[0]
  const remaining = sorted.slice(1)

  let subtitle: typeof title | null = null
  if (remaining.length > 0) {
    // pick candidate close to title vertically and relatively large
    const titleY = title.bbox[1] ?? 0
    const titleH = title.bbox[3] ?? 1
    const candidates = remaining
      .map((b) => {
        const dy = Math.max(0, (b.bbox[1] ?? 0) - titleY)
        const height = b.bbox[3] ?? 0
        const area = bboxArea(b.bbox)
        const score = height * 10 + area * 0.001 - dy * 0.5
        return { b, score, dy }
      })
      .sort((a, b) => b.score - a.score)

    const best = candidates[0]
    // heuristic gate: must be below or near title and not too tiny
    if (best && best.dy <= Math.max(200, titleH * 4) && (best.b.bbox[3] ?? 0) >= Math.max(18, titleH * 0.35)) {
      subtitle = best.b
    }
  }

  const out: RoleBlock[] = []
  out.push({ role: 'title', text: title.text, bbox: title.bbox })

  const usedIds = new Set<string>([title.text + JSON.stringify(title.bbox)])
  if (subtitle) {
    usedIds.add(subtitle.text + JSON.stringify(subtitle.bbox))
    out.push({ role: 'subtitle', text: subtitle.text, bbox: subtitle.bbox })
  }

  const body = cleaned
    .filter((b) => !usedIds.has(b.text + JSON.stringify(b.bbox)))
    .sort((a, b) => (a.bbox[1] ?? 0) - (b.bbox[1] ?? 0))
    .slice(0, 5)

  for (const b of body) out.push({ role: 'body', text: b.text, bbox: b.bbox })

  // ensure strict roles only
  return out.map((r) => ({ ...r, role: (r.role as PptTextRole) ?? 'body' }))
}

