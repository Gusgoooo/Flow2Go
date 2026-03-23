import type { CSSProperties, ReactNode } from 'react'

/** 标签沿路径的放置方式（相对路径几何，非屏幕） */
export type EdgeLabelPlacement = 'center' | 'head' | 'tail' | 'manual'

/** 存在 edge.data.labelLayout，供序列化与配置 */
export type EdgeLabelLayoutConfig = {
  placement?: EdgeLabelPlacement
  /** 仅 placement === 'manual' 时：相对路径中心点的偏移（flow 坐标） */
  offsetX?: number
  offsetY?: number
}

/** 路径上三个关键锚点（均为 flow 坐标，语义中心点） */
export type EdgeLabelAnchors = {
  center: { x: number; y: number }
  head: { x: number; y: number }
  tail: { x: number; y: number }
}

export type EdgeLabelStyle = {
  fontSize?: number
  fontWeight?: string
  color?: string
}

/** 碰撞解析器维护的状态（运行时，可不持久化） */
export type EdgeLabelCollisionState = {
  activeAnchor: 'center' | 'head' | 'tail'
  nudgeX: number
  nudgeY: number
}

export type SmartEdgeLabelProps = {
  edgeId: string
  anchors: EdgeLabelAnchors
  labelLayout?: EdgeLabelLayoutConfig
  labelStyle?: EdgeLabelStyle
  /** 展示用文本（单行省略） */
  text: string
  editing: boolean
  /** 编辑态子树（textarea + toolbar 等） */
  editChildren: ReactNode
  /** 非编辑且无文本时不渲染占位 */
  showWhenEmpty?: boolean
  zIndex?: number
  className?: string
  style?: CSSProperties
  /** 外层 div 的 pointer-events（线段拖拽手柄等需 all） */
  pointerEvents?: 'all' | 'none'
  onPointerDown?: React.MouseEventHandler<HTMLDivElement>
  onDoubleClick?: React.MouseEventHandler<HTMLDivElement>
  /** 标签块最大宽度（px，CSS），过长省略 */
  maxLabelWidth?: number
}

export type FlowRect = {
  left: number
  top: number
  right: number
  bottom: number
}
