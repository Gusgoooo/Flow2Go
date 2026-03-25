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
    // Right→Left：竖线在 target 左侧，末段从左向右指向左端口；若用中点 midX 且 midX>tx 会末段向左、箭头朝外。
    // Left→Right：竖线在 target 右侧，末段从右向左指向右端口。
    let midX = (sourceX + targetX) / 2 + autoOffset
    if (sourcePosition === Position.Right && targetPosition === Position.Left) {
      midX = Math.min(sourceX, targetX) - offset + autoOffset
    } else if (sourcePosition === Position.Left && targetPosition === Position.Right) {
      midX = Math.max(sourceX, targetX) + offset + autoOffset
    }
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
