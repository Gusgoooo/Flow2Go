import type {
  AutoLayoutOp,
  CreateEdgeOp,
  CreateFrameOp,
  CreateNodeQuadOp,
  GraphBatchPayload,
  GraphWarning,
  MermaidFlowIR,
  MermaidToGraphResult,
} from './types'

function slug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^\w\u4e00-\u9fa5-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function buildFrameId(title: string, used: Set<string>): string {
  const base = `frame_${slug(title) || 'group'}`
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  let i = 2
  while (used.has(`${base}_${i}`)) i += 1
  const next = `${base}_${i}`
  used.add(next)
  return next
}

function buildEdgeId(source: string, target: string, count: Map<string, number>) {
  const key = `${source}__${target}`
  const next = (count.get(key) ?? 0) + 1
  count.set(key, next)
  return `edge_${source}_${target}_${next}`
}

function isIdLikeTitle(id: string, title: string): boolean {
  const t = title.trim()
  const i = id.trim()
  if (!t) return true
  if (t === i) return true
  // 常见占位/自动编号形态：a1 / b12 / n_3 / node_9
  if (/^(?:[a-z]{1,3}\d+|n[_-]?\d+|node[_-]?\d+)$/i.test(t)) return true
  return false
}

function buildReadableFallbackTitle(idx: number): string {
  return `步骤${idx}`
}

export function transpileMermaidFlowIR(
  ir: MermaidFlowIR,
  rawMermaid?: string,
  upstreamWarnings: GraphWarning[] = [],
): MermaidToGraphResult {
  const warnings: GraphWarning[] = [...upstreamWarnings]
  const frameIdSet = new Set<string>()
  const frameIdMap = new Map<string, string>()
  const edgeCounter = new Map<string, number>()

  // operations order is fixed by spec
  const frameOps: CreateFrameOp[] = []
  const nodeOps: CreateNodeQuadOp[] = []
  const edgeOps: CreateEdgeOp[] = []
  const layoutOps: AutoLayoutOp[] = []

  // 1) frames
  for (const sg of ir.subgraphs) {
    const frameId = buildFrameId(sg.title, frameIdSet)
    frameIdMap.set(sg.id, frameId)
    const parentFrameId = sg.parentSubgraphId ? frameIdMap.get(sg.parentSubgraphId) : undefined
    frameOps.push({
      op: 'graph.createFrame',
      params: { id: frameId, title: sg.title, ...(parentFrameId ? { parentId: parentFrameId } : {}) },
    })
  }

  // 2) nodes (dedupe by id, first wins)
  const createdNodeIds = new Set<string>()
  let fallbackTitleCounter = 1
  for (const node of ir.nodes) {
    if (createdNodeIds.has(node.id)) continue
    createdNodeIds.add(node.id)
    const parentId = node.subgraphId ? frameIdMap.get(node.subgraphId) : undefined
    const title = isIdLikeTitle(node.id, node.label)
      ? buildReadableFallbackTitle(fallbackTitleCounter++)
      : node.label
    nodeOps.push({
      op: 'graph.createNodeQuad',
      params: {
        id: node.id,
        title,
        ...(node.subtitle ? { subtitle: node.subtitle } : {}),
        shape: node.shape,
        ...(parentId ? { parentId } : {}),
      },
    })
  }

  // 3) edges (auto-build missing nodes if parser didn't)
  for (const edge of ir.edges) {
    if (!createdNodeIds.has(edge.source)) {
      createdNodeIds.add(edge.source)
      warnings.push({
        code: 'NODE_IMPLICIT_CREATE',
        message: `Node ${edge.source} not explicitly declared; implicitly created from edge.`,
        line: edge.line,
        raw: edge.raw,
      })
      nodeOps.push({
        op: 'graph.createNodeQuad',
        params: { id: edge.source, title: buildReadableFallbackTitle(fallbackTitleCounter++), shape: 'rect' },
      })
    }
    if (!createdNodeIds.has(edge.target)) {
      createdNodeIds.add(edge.target)
      warnings.push({
        code: 'NODE_IMPLICIT_CREATE',
        message: `Node ${edge.target} not explicitly declared; implicitly created from edge.`,
        line: edge.line,
        raw: edge.raw,
      })
      nodeOps.push({
        op: 'graph.createNodeQuad',
        params: { id: edge.target, title: buildReadableFallbackTitle(fallbackTitleCounter++), shape: 'rect' },
      })
    }

    edgeOps.push({
      op: 'graph.createEdge',
      params: {
        id: buildEdgeId(edge.source, edge.target, edgeCounter),
        source: edge.source,
        target: edge.target,
        ...(edge.label ? { label: edge.label } : {}),
        type: 'bezier',
        arrowStyle: 'end',
      },
    })
  }

  // 4) layout per frame
  for (const sg of ir.subgraphs) {
    const frameId = frameIdMap.get(sg.id)
    if (!frameId) continue
    layoutOps.push({
      op: 'graph.autoLayout',
      params: { direction: ir.direction, scope: 'withinFrame', frameId },
    })
  }

  // 5) optional global layout if there are top-level nodes
  const hasTopLevelNodes = nodeOps.some((op) => !op.params.parentId)
  if (hasTopLevelNodes) {
    layoutOps.push({
      op: 'graph.autoLayout',
      params: { direction: ir.direction, scope: 'all' },
    })
  }

  const operations = ([] as Array<CreateFrameOp | CreateNodeQuadOp | CreateEdgeOp | AutoLayoutOp>).concat(
    frameOps,
    nodeOps,
    edgeOps,
    layoutOps,
  )

  const data: GraphBatchPayload = {
    version: '1.0',
    source: 'mermaid',
    graphType: 'flowchart',
    direction: ir.direction,
    operations,
    meta: { rawMermaid },
  }

  return { success: true, data, warnings, errors: [] }
}
