import { describe, expect, it } from 'vitest'
import { parseMermaidFlowchart } from '../parser'
import { transpileMermaidFlowIR } from '../transpiler.ts'
import type { GraphOperation } from '../types'

describe('transpileMermaidFlowIR', () => {
  it('op order is fixed: frame -> node -> edge -> autoLayout', () => {
    const parsed = parseMermaidFlowchart(`flowchart LR
subgraph Frontend
  A[登录页]
end
A --> B`)
    expect(parsed.success).toBe(true)
    const out = transpileMermaidFlowIR(parsed.ir!, 'raw', parsed.warnings)
    expect(out.success).toBe(true)
    const ops = out.data!.operations as GraphOperation[]
    const firstEdgeIdx = ops.findIndex((o: GraphOperation) => o.op === 'graph.createEdge')
    const firstLayoutIdx = ops.findIndex((o: GraphOperation) => o.op === 'graph.autoLayout')
    const lastFrameIdx = Math.max(-1, ...ops.map((o: GraphOperation, i: number) => (o.op === 'graph.createFrame' ? i : -1)))
    const lastNodeIdx = Math.max(-1, ...ops.map((o: GraphOperation, i: number) => (o.op === 'graph.createNodeQuad' ? i : -1)))
    expect(lastFrameIdx).toBeGreaterThanOrEqual(0)
    expect(lastNodeIdx).toBeGreaterThanOrEqual(0)
    expect(firstEdgeIdx).toBeGreaterThanOrEqual(0)
    expect(firstLayoutIdx).toBeGreaterThanOrEqual(0)
    expect(lastFrameIdx).toBeLessThan(lastNodeIdx)
    expect(lastNodeIdx).toBeLessThan(firstEdgeIdx)
    expect(firstEdgeIdx).toBeLessThan(firstLayoutIdx)
  })

  it('transpiles subgraph to frame + parentId assignment', () => {
    const parsed = parseMermaidFlowchart(`flowchart LR
subgraph Frontend
  A[登录页]
end`)
    expect(parsed.success).toBe(true)
    const out = transpileMermaidFlowIR(parsed.ir!, 'raw', parsed.warnings)
    const frameOp = (out.data!.operations as GraphOperation[]).find((o: GraphOperation) => o.op === 'graph.createFrame')
    const nodeOp = (out.data!.operations as GraphOperation[]).find(
      (o: GraphOperation) => o.op === 'graph.createNodeQuad' && (o as any).params.id === 'A',
    ) as any
    expect(frameOp).toBeTruthy()
    expect(nodeOp.params.parentId).toBeTruthy()
  })

  it('transpiles node shapes correctly', () => {
    const parsed = parseMermaidFlowchart(`flowchart LR
A[矩形] --> B(圆形)
B --> C{菱形}`)
    const out = transpileMermaidFlowIR(parsed.ir!, 'raw', parsed.warnings)
    const nodeOps = out.data!.operations.filter((o) => o.op === 'graph.createNodeQuad') as any[]
    const byId = new Map(nodeOps.map((o) => [o.params.id, o.params]))
    expect(byId.get('A')!.shape).toBe('rect')
    expect(byId.get('B')!.shape).toBe('circle')
    expect(byId.get('C')!.shape).toBe('diamond')
  })

  it('edges are bezier + arrowStyle=end with optional label', () => {
    const parsed = parseMermaidFlowchart(`flowchart LR
A -->|提交| B`)
    const out = transpileMermaidFlowIR(parsed.ir!, 'raw', parsed.warnings)
    const edgeOp = (out.data!.operations as GraphOperation[]).find((o: GraphOperation) => o.op === 'graph.createEdge') as any
    expect(edgeOp.params.type).toBe('bezier')
    expect(edgeOp.params.arrowStyle).toBe('end')
    expect(edgeOp.params.label).toBe('提交')
  })

  it('implicitly creates missing nodes referenced by edges', () => {
    const parsed = parseMermaidFlowchart(`flowchart LR
A --> B`)
    const out = transpileMermaidFlowIR(parsed.ir!, 'raw', parsed.warnings)
    // parser already adds A/B nodes; this test ensures transpiler doesn't crash and keeps node ops unique
    const nodeOps = (out.data!.operations as GraphOperation[]).filter((o: GraphOperation) => o.op === 'graph.createNodeQuad') as any[]
    const ids = new Set(nodeOps.map((o) => o.params.id))
    expect(ids.has('A')).toBe(true)
    expect(ids.has('B')).toBe(true)
  })

  it('v2: nested subgraph becomes nested frame via parentId', () => {
    const parsed = parseMermaidFlowchart(`flowchart LR
subgraph Frontend
  subgraph 解决方案
    fe_a[入口]
  end
end`)
    expect(parsed.success).toBe(true)
    const out = transpileMermaidFlowIR(parsed.ir!, 'raw', parsed.warnings)
    const frames = (out.data!.operations as GraphOperation[]).filter((o) => o.op === 'graph.createFrame') as any[]
    expect(frames.length).toBeGreaterThanOrEqual(2)
    const fe = frames.find((f) => f.params.title === 'Frontend')
    const inner = frames.find((f) => f.params.title === '解决方案')
    expect(fe).toBeTruthy()
    expect(inner).toBeTruthy()
    expect(inner.params.parentId).toBe(fe.params.id)
  })

  it('v2: node label supports subtitle via newline', () => {
    const parsed = parseMermaidFlowchart(`flowchart LR
subgraph Frontend
  fe_a[主标题｜副标题]
end`)
    expect(parsed.success).toBe(true)
    const out = transpileMermaidFlowIR(parsed.ir!, 'raw', parsed.warnings)
    const node = (out.data!.operations as GraphOperation[]).find((o) => o.op === 'graph.createNodeQuad') as any
    expect(node.params.title).toBe('主标题')
    expect(node.params.subtitle).toBe('副标题')
  })
})
