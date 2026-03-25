import { Position } from '@xyflow/react'

export type OrthogonalPoint = { x: number; y: number }

/**
 * 根据源和目标位置生成默认的正交路径点（与 handle 方向一致的 Z / C / L 型）
 */
export function getDefaultOrthogonalPoints(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  sourcePosition: Position,
  targetPosition: Position,
  offset: number = 24,
  autoOffset: number = 0,
): OrthogonalPoint[] {
  const isHorizontalSource = sourcePosition === Position.Left || sourcePosition === Position.Right
  const isHorizontalTarget = targetPosition === Position.Left || targetPosition === Position.Right
  const isCShape = sourcePosition === targetPosition

  const source = { x: sourceX, y: sourceY }
  const target = { x: targetX, y: targetY }

  if (isHorizontalSource && isHorizontalTarget) {
    if (isCShape) {
      const isRight = sourcePosition === Position.Right
      const outerX = isRight
        ? Math.max(sourceX, targetX) + offset + autoOffset
        : Math.min(sourceX, targetX) - offset + autoOffset
      return [source, { x: outerX, y: sourceY }, { x: outerX, y: targetY }, target]
    }
    // 交叉位次（例如 Right→Left 且 target 在 source 左边）：
    // 需要同时满足 source 先按 out 方向离开、target 再按 in 方向进入，
    // 因此使用「双外廊 + 中轴」的 5 段折线，而不是直接中点 Z 型。
    if (sourcePosition === Position.Right && targetPosition === Position.Left && targetX <= sourceX) {
      const xOut = sourceX + offset
      const xIn = targetX - offset
      const midY = (sourceY + targetY) / 2 + autoOffset
      return [source, { x: xOut, y: sourceY }, { x: xOut, y: midY }, { x: xIn, y: midY }, { x: xIn, y: targetY }, target]
    }
    if (sourcePosition === Position.Left && targetPosition === Position.Right && targetX >= sourceX) {
      const xOut = sourceX - offset
      const xIn = targetX + offset
      const midY = (sourceY + targetY) / 2 + autoOffset
      return [source, { x: xOut, y: sourceY }, { x: xOut, y: midY }, { x: xIn, y: midY }, { x: xIn, y: targetY }, target]
    }
    // Z 型：末段必须沿「in」方向水平接近 target，使 markerEnd（orient=auto）箭头朝节点内侧。
    // 对“非交叉位次”的情况，优先走中线（更容易触发避障绕开中间节点，如 A->C 需绕 B）。
    // 交叉位次已在上方用 5 段折线处理，避免箭头朝外。
    const midX = (sourceX + targetX) / 2 + autoOffset
    return [source, { x: midX, y: sourceY }, { x: midX, y: targetY }, target]
  }
  if (!isHorizontalSource && !isHorizontalTarget) {
    if (isCShape) {
      const isBottom = sourcePosition === Position.Bottom
      const outerY = isBottom
        ? Math.max(sourceY, targetY) + offset + autoOffset
        : Math.min(sourceY, targetY) - offset + autoOffset
      return [source, { x: sourceX, y: outerY }, { x: targetX, y: outerY }, target]
    }
    // 交叉位次（例如 Bottom→Top 且 target 在 source 上方，同时存在明显水平位移）：
    // 用多一折的 5 段折线，让 source 先按 out 方向离开、target 再按 in 方向进入，
    // 并为中间避让留下稳定的“走廊”。
    if (sourcePosition === Position.Bottom && targetPosition === Position.Top && targetY <= sourceY && Math.abs(targetX - sourceX) > 1e-3) {
      const yOut = sourceY + offset
      const yIn = targetY - offset
      const midX = (sourceX + targetX) / 2 + autoOffset
      return [source, { x: sourceX, y: yOut }, { x: midX, y: yOut }, { x: midX, y: yIn }, { x: targetX, y: yIn }, target]
    }
    if (sourcePosition === Position.Top && targetPosition === Position.Bottom && targetY >= sourceY && Math.abs(targetX - sourceX) > 1e-3) {
      const yOut = sourceY - offset
      const yIn = targetY + offset
      const midX = (sourceX + targetX) / 2 + autoOffset
      return [source, { x: sourceX, y: yOut }, { x: midX, y: yOut }, { x: midX, y: yIn }, { x: targetX, y: yIn }, target]
    }
    let midY = (sourceY + targetY) / 2 + autoOffset
    if (sourcePosition === Position.Bottom && targetPosition === Position.Top) {
      midY = Math.min(sourceY, targetY) - offset + autoOffset
    } else if (sourcePosition === Position.Top && targetPosition === Position.Bottom) {
      midY = Math.max(sourceY, targetY) + offset + autoOffset
    }
    return [source, { x: sourceX, y: midY }, { x: targetX, y: midY }, target]
  }
  if (isHorizontalSource) {
    return [source, { x: targetX, y: sourceY + autoOffset }, target]
  }
  return [source, { x: sourceX + autoOffset, y: targetY }, target]
}
