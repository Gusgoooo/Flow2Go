import type { EdgeLabelAnchors, EdgeLabelCollisionState, EdgeLabelPlacement, FlowRect } from './types'

const GAP = 2

export type CollisionLabelSpec = {
  id: string
  preferred: EdgeLabelPlacement
  anchors: EdgeLabelAnchors
  manual: { x: number; y: number }
  state: EdgeLabelCollisionState
}

function boxFromCenter(cx: number, cy: number, w: number, h: number): FlowRect {
  const hw = w / 2
  const hh = h / 2
  return { left: cx - hw, top: cy - hh, right: cx + hw, bottom: cy + hh }
}

export function flowRectsOverlap(a: FlowRect, b: FlowRect, gap = GAP): boolean {
  return !(a.right + gap <= b.left || b.right + gap <= a.left || a.bottom + gap <= b.top || b.bottom + gap <= a.top)
}

function centerForSpec(spec: CollisionLabelSpec): { cx: number; cy: number } {
  const { preferred, anchors, manual, state } = spec
  const ax = anchors[state.activeAnchor]
  if (preferred === 'manual') {
    return {
      cx: anchors.center.x + manual.x + state.nudgeX,
      cy: anchors.center.y + manual.y + state.nudgeY,
    }
  }
  return {
    cx: ax.x + state.nudgeX,
    cy: ax.y + state.nudgeY,
  }
}

function cloneState(s: EdgeLabelCollisionState): EdgeLabelCollisionState {
  return { activeAnchor: s.activeAnchor, nudgeX: s.nudgeX, nudgeY: s.nudgeY }
}

const Y_TRIES = [12, -12, 20, -20, 32, -32, 48, -48]
const XY_TRIES: Array<[number, number]> = [
  [16, 0],
  [-16, 0],
  [24, 0],
  [-24, 0],
]

/**
 * 轻量级避让：优先上下 nudge，再尝试切换 head/tail，再水平加大 offset；固定最大轮数。
 */
export function resolveEdgeLabelCollisions(
  specs: CollisionLabelSpec[],
  sizes: Map<string, { w: number; h: number }>,
  maxRounds = 10,
): Map<string, EdgeLabelCollisionState> {
  const states = new Map<string, EdgeLabelCollisionState>()
  for (const s of specs) {
    states.set(s.id, cloneState(s.state))
  }

  const getBoxes = (): Array<{ id: string; rect: FlowRect }> => {
    const out: Array<{ id: string; rect: FlowRect }> = []
    for (const spec of specs) {
      const st = states.get(spec.id)
      const sz = sizes.get(spec.id)
      if (!st || !sz || sz.w <= 0 || sz.h <= 0) continue
      const { cx, cy } = centerForSpec({ ...spec, state: st })
      out.push({ id: spec.id, rect: boxFromCenter(cx, cy, sz.w, sz.h) })
    }
    return out
  }

  const hasOverlapFor = (id: string, boxes: Array<{ id: string; rect: FlowRect }>): boolean => {
    const self = boxes.find((b) => b.id === id)
    if (!self) return false
    for (const o of boxes) {
      if (o.id === id) continue
      if (flowRectsOverlap(self.rect, o.rect)) return true
    }
    return false
  }

  const anyOverlap = (boxes: Array<{ id: string; rect: FlowRect }>): boolean => {
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        if (flowRectsOverlap(boxes[i].rect, boxes[j].rect)) return true
      }
    }
    return false
  }

  for (let round = 0; round < maxRounds; round += 1) {
    const boxes = getBoxes()
    if (!anyOverlap(boxes)) break

    const victims = [...specs].sort((a, b) => a.id.localeCompare(b.id))
    let improved = false

    for (const spec of victims) {
      const st0 = states.get(spec.id)
      if (!st0 || !sizes.has(spec.id)) continue
      if (!hasOverlapFor(spec.id, boxes)) continue

      const snap0 = cloneState(st0)

      const tryY = (next: EdgeLabelCollisionState): boolean => {
        states.set(spec.id, next)
        if (!hasOverlapFor(spec.id, getBoxes())) {
          improved = true
          return true
        }
        states.set(spec.id, cloneState(snap0))
        return false
      }

      for (const dy of Y_TRIES) {
        if (tryY({ ...snap0, nudgeY: snap0.nudgeY + dy })) break
      }
      if (!hasOverlapFor(spec.id, getBoxes())) continue

      const snap1 = cloneState(states.get(spec.id)!)

      if (spec.preferred !== 'manual') {
        const tryAnchor = (next: EdgeLabelCollisionState): boolean => {
          states.set(spec.id, next)
          if (!hasOverlapFor(spec.id, getBoxes())) {
            improved = true
            return true
          }
          states.set(spec.id, cloneState(snap1))
          return false
        }
        const order: Array<'center' | 'head' | 'tail'> = ['head', 'tail', 'center']
        for (const anchor of order) {
          if (anchor === snap1.activeAnchor) continue
          if (tryAnchor({ ...snap1, activeAnchor: anchor })) break
        }
      }
      if (!hasOverlapFor(spec.id, getBoxes())) continue

      const snap2 = cloneState(states.get(spec.id)!)

      const tryXY = (next: EdgeLabelCollisionState): boolean => {
        states.set(spec.id, next)
        if (!hasOverlapFor(spec.id, getBoxes())) {
          improved = true
          return true
        }
        states.set(spec.id, cloneState(snap2))
        return false
      }
      for (const [dx, dy] of XY_TRIES) {
        if (tryXY({ ...snap2, nudgeX: snap2.nudgeX + dx, nudgeY: snap2.nudgeY + dy })) break
      }
    }

    if (!improved) break
  }

  return states
}

export function initialCollisionState(preferred: EdgeLabelPlacement): EdgeLabelCollisionState {
  if (preferred === 'head' || preferred === 'tail' || preferred === 'center') {
    return { activeAnchor: preferred, nudgeX: 0, nudgeY: 0 }
  }
  return { activeAnchor: 'center', nudgeX: 0, nudgeY: 0 }
}
