export type FlowDirection = 'LR' | 'TB' | 'RL' | 'BT'

export type GraphWarning = {
  code: string
  message: string
  line?: number
  raw?: string
}

export type GraphError = {
  code: string
  message: string
  line?: number
  raw?: string
}

export type MermaidNodeShape = 'rect' | 'circle' | 'diamond'

export type MermaidIRNode = {
  id: string
  label: string
  subtitle?: string
  shape: MermaidNodeShape
  subgraphId?: string
  line?: number
  raw?: string
}

export type MermaidIREdge = {
  source: string
  target: string
  label?: string
  line?: number
  raw?: string
}

export type MermaidIRSubgraph = {
  id: string
  title: string
  nodeIds: string[]
  parentSubgraphId?: string
  line?: number
  raw?: string
}

export type MermaidFlowIR = {
  direction: FlowDirection
  subgraphs: MermaidIRSubgraph[]
  nodes: MermaidIRNode[]
  edges: MermaidIREdge[]
}

export type GroupStyle = Record<string, unknown>
export type QuadStyle = Record<string, unknown>
export type EdgeStyle = Record<string, unknown>

export type CreateFrameOp = {
  op: 'graph.createFrame'
  params: {
    id: string
    title: string
    position?: { x: number; y: number }
    size?: { width: number; height: number }
    style?: Partial<GroupStyle>
    parentId?: string
  }
}

export type CreateNodeQuadOp = {
  op: 'graph.createNodeQuad'
  params: {
    id: string
    title: string
    subtitle?: string
    shape?: 'rect' | 'circle' | 'diamond'
    style?: Partial<QuadStyle>
    position?: { x: number; y: number }
    parentId?: string
  }
}

export type CreateEdgeOp = {
  op: 'graph.createEdge'
  params: {
    id: string
    source: string
    target: string
    type?: 'smoothstep' | 'bezier'
    label?: string
    arrowStyle?: 'none' | 'end' | 'start' | 'both'
    style?: Partial<EdgeStyle>
  }
}

export type AutoLayoutOp = {
  op: 'graph.autoLayout'
  params: {
    direction: FlowDirection
    scope: 'all' | 'withinFrame'
    frameId?: string
  }
}

export type GraphOperation =
  | CreateFrameOp
  | CreateNodeQuadOp
  | CreateEdgeOp
  | AutoLayoutOp

export type LayoutProfile = 'default' | 'flow' | 'mindmap' | 'swimlane'

export type GraphBatchPayload = {
  version: '1.0'
  source: 'mermaid' | 'swimlane-draft'
  graphType: 'flowchart' | 'swimlane'
  direction: FlowDirection
  operations: GraphOperation[]
  meta?: {
    rawMermaid?: string
    /** 如 `mind-map`、`flowchart`、`swimlane` */
    layoutProfile?: string
    swimlaneDirection?: 'horizontal' | 'vertical'
    /**
     * 自然语言生成：为 true 时不自动套用语义节点/画框/思维导图预设彩色，仅保留中性灰白与默认结构；
     * 识图导入、用户显式配色等路径保持 false。
     */
    neutralGeneration?: boolean
    /** 图生图泳道：物化时强制默认泳道底色，忽略 payload 中泳道配色 */
    swimlaneImageImport?: boolean
  }
}

export type MermaidToGraphResult = {
  success: boolean
  data: GraphBatchPayload | null
  warnings: GraphWarning[]
  errors: GraphError[]
}

export type ParseMermaidResult = {
  success: boolean
  ir: MermaidFlowIR | null
  warnings: GraphWarning[]
  errors: GraphError[]
}

/** 统一返回：Mermaid -> GraphBatchPayload */
export type MermaidToGraphResultV1 = MermaidToGraphResult