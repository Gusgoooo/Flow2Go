import { Position } from '@xyflow/react'

/** 连线在源/目标端口处与节点轮廓的间隙（像素），首尾一致 */
export const EDGE_HANDLE_GAP_PX = 2

function outwardDelta(pos: Position, pad: number): { dx: number; dy: number } {
  switch (pos) {
    case Position.Right:
      return { dx: pad, dy: 0 }
    case Position.Left:
      return { dx: -pad, dy: 0 }
    case Position.Bottom:
      return { dx: 0, dy: pad }
    case Position.Top:
      return { dx: 0, dy: -pad }
    default:
      return { dx: 0, dy: 0 }
  }
}

/**
 * 将边的起止点从 handle 中心沿端口朝外平移，使可见路径与节点边缘留出固定间隙。
 * 与 @xyflow/system 的 handleDirections 方向一致。
 */
export function padEdgeEndpoints(args: {
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition: Position
  targetPosition: Position
  /** 默认 EDGE_HANDLE_GAP_PX */
  pad?: number
}): { sourceX: number; sourceY: number; targetX: number; targetY: number } {
  const pad = args.pad ?? EDGE_HANDLE_GAP_PX
  const s = outwardDelta(args.sourcePosition, pad)
  const t = outwardDelta(args.targetPosition, pad)
  return {
    sourceX: args.sourceX + s.dx,
    sourceY: args.sourceY + s.dy,
    targetX: args.targetX + t.dx,
    targetY: args.targetY + t.dy,
  }
}
