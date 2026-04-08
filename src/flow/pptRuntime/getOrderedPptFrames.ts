import type { Node } from '@xyflow/react'
import { PPT_FRAME_ROLE } from '../constants'

export type PptFrameNode = Node<any> & {
  type: 'group'
  data?: { role?: string; slideIndex?: number; slideName?: string }
}

function toNumberMaybe(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const n = Number(String(v ?? '').trim())
  return Number.isFinite(n) ? n : null
}

export function getOrderedPptFrames(nodes: Node[]): PptFrameNode[] {
  const frames = (Array.isArray(nodes) ? nodes : []).filter((n) => {
    if (!n || n.type !== 'group') return false
    if (n.parentId) return false
    const role = (n.data as any)?.role
    return role === PPT_FRAME_ROLE
  }) as PptFrameNode[]

  const parsed = frames
    .map((f) => {
      const slideIndex = toNumberMaybe((f.data as any)?.slideIndex)
      const slideName = (f.data as any)?.slideName
      const fallback = slideIndex ?? toNumberMaybe(slideName)
      return { f, slideIndex: fallback }
    })
    .filter((x) => x.slideIndex != null)
    .sort((a, b) => (a.slideIndex as number) - (b.slideIndex as number))

  return parsed.map((x) => {
    const idx = x.slideIndex as number
    return { ...x.f, data: { ...((x.f.data as any) ?? {}), slideIndex: idx } }
  })
}

