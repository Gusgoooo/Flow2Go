import { Position } from '@xyflow/react'

/**
 * 连线端点相对 handle 中心沿端口朝外平移距离（像素）。
 * 设为 0 时，线端点紧贴节点 handle；避让由中段正交路由负责。
 */
export const EDGE_HANDLE_GAP_PX = 0

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
