/**
 * Business Big Map IR — 唯一中间语义层。
 *
 * 规则：
 *  - 不包含任何坐标、尺寸或排版信息
 *  - 可完整表达多层嵌套结构
 *  - 可被校验与修复
 *  - 文生图与图生图最终都必须收敛到此 IR
 */

export type SemanticRole =
  | 'domain'
  | 'module'
  | 'capability'
  | 'feature'
  | 'service'
  | 'component'
  | 'unknown'

export type BigMapNodeType = 'container' | 'node'

export interface BigMapIRNode {
  id: string
  title: string
  type: BigMapNodeType
  semanticRole: SemanticRole
  /** 同级顺序（0-based） */
  order: number
  /** 子节点 id 列表（仅 container 有意义） */
  children: string[]
  /** 节点附加描述（可选） */
  description?: string
  /** 节点标签/tag（可选，用于分类着色） */
  tags?: string[]
}

/**
 * Business Big Map IR 顶层结构。
 */
export interface BusinessBigMapIR {
  schema: 'flow2go.business-big-map.v1'
  title: string
  /** 所有节点（含嵌套容器与叶子节点） */
  nodes: BigMapIRNode[]
  /** IR 级别的元信息（可选） */
  meta?: {
    source: 'text' | 'image'
    /** 原始输入摘要（用于可观察性） */
    rawInputSummary?: string
  }
}

// ─── 布局阶段中间结构（IR → Layout → Normalize → Render） ───

export interface BigMapLayoutNode {
  id: string
  title: string
  type: BigMapNodeType
  semanticRole: SemanticRole
  order: number
  children: string[]
  description?: string
  tags?: string[]
  /** 由 measureText 计算，布局前写入 */
  width: number
  height: number
  /** 由 ELK 写入 */
  x: number
  y: number
}

export interface BigMapLayoutResult {
  nodes: BigMapLayoutNode[]
  /** 根容器宽高（整张图的包围盒） */
  totalWidth: number
  totalHeight: number
}

// ─── 可观察性 ───

export type BigMapPipelineStage =
  | 'input'
  | 'ir'
  | 'sized'
  | 'layout'
  | 'normalized'
  | 'validated'
  | 'materialized'

export interface BigMapPipelineLog {
  stage: BigMapPipelineStage
  timestamp: number
  data: unknown
  /** 仅 validated 阶段 */
  issues?: BigMapValidationIssue[]
}

export type BigMapValidationSeverity = 'error' | 'warning' | 'info'

export interface BigMapValidationIssue {
  severity: BigMapValidationSeverity
  nodeId?: string
  message: string
  autoFixed: boolean
}
