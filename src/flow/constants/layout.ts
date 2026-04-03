export { GRID_UNIT, HANDLE_ALIGN_UNIT, SIZE_STEP_RATIO } from '../grid'

/** Mermaid / 思维导图共用布局单元（24px） */
export const LAYOUT_UNIT = 24

/** 节点默认尺寸 */
export const DEFAULT_QUAD_SIZE = { w: 160, h: 48 }
export const DEFAULT_TEXT_SIZE = { w: 64, h: 32 }
export const DEFAULT_GROUP_SIZE = { w: 640, h: 416 }

/** 节点尺寸按形状（w/h 格式，swimlane 等使用） */
export const DEFAULT_NODE_SIZES: Record<string, { w: number; h: number }> = {
  rect: { w: 160, h: 48 },
  circle: { w: 64, h: 64 },
  diamond: { w: 96, h: 64 },
}

/** 节点尺寸按类别（width/height 格式，路由避让使用） */
export const DEFAULT_SIZE_BY_KIND: Record<string, { width: number; height: number }> = {
  rect: { width: 160, height: 48 },
  circle: { width: 64, height: 64 },
  diamond: { width: 96, height: 64 },
  text: { width: 120, height: 32 },
  asset: { width: 96, height: 96 },
}
