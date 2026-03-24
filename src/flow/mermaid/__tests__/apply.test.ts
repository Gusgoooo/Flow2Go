import { describe, expect, it, vi } from 'vitest'
import { applyGraphBatchPayload } from '../apply.ts'
import type { GraphBatchPayload, GraphOperation } from '../types'
import { materializeGraphBatchPayloadToSnapshot } from '../apply.ts'

describe('applyGraphBatchPayload', () => {
  it('prefers graph.batch', async () => {
    const batch = vi.fn()

    const payload: GraphBatchPayload = {
      version: '1.0',
      source: 'mermaid',
      graphType: 'flowchart',
      direction: 'LR',
      operations: [],
    }

    await applyGraphBatchPayload(payload, { graph: { batch } })

    expect(batch).toHaveBeenCalledTimes(1)
    expect(batch).toHaveBeenCalledWith({ reason: 'ai-apply', operations: [] })
  })

  it('falls back to applyOperation sequentially when batch missing', async () => {
    const calls: GraphOperation[] = []
    const applyOperation = vi.fn(async (op: GraphOperation) => {
      calls.push(op)
    })

    const payload: GraphBatchPayload = {
      version: '1.0',
      source: 'mermaid',
      graphType: 'flowchart',
      direction: 'LR',
      operations: [
        { op: 'graph.createFrame', params: { id: 'frame_1', title: 'Frontend' } },
        { op: 'graph.createNodeQuad', params: { id: 'A', title: '登录页', shape: 'rect', parentId: 'frame_1' } },
      ],
    }

    await applyGraphBatchPayload(payload, { graph: { applyOperation } })
    expect(applyOperation).toHaveBeenCalledTimes(2)
    expect(calls[0].op).toBe('graph.createFrame')
    expect(calls[1].op).toBe('graph.createNodeQuad')
  })
})

describe('materializeGraphBatchPayloadToSnapshot - handle inference', () => {
  it('avoids using the same side as an incoming edge when reasonable', async () => {
    const payload: GraphBatchPayload = {
      version: '1.0',
      source: 'mermaid',
      graphType: 'flowchart',
      direction: 'LR',
      operations: [
        { op: 'graph.createNodeQuad', params: { id: 'A', title: 'A', shape: 'rect', position: { x: 0, y: 0 } } },
        // B is below-right of A, so bottom would be a natural choice
        { op: 'graph.createNodeQuad', params: { id: 'B', title: 'B', shape: 'rect', position: { x: 80, y: 120 } } },
        // Place X below A so X -> A enters A from bottom (t-bottom)
        { op: 'graph.createNodeQuad', params: { id: 'X', title: 'X', shape: 'rect', position: { x: 0, y: 240 } } },
        // Incoming edge occupies A's bottom side (enters from bottom)
        {
          op: 'graph.createEdge',
          params: { id: 'e_in', source: 'X', target: 'A', type: 'smoothstep', arrowStyle: 'end', style: { strokeWidth: 1.5 } },
        },
        // This edge should prefer bottom by geometry, but avoid bottom due to incoming occupancy
        { op: 'graph.createEdge', params: { id: 'e_out', source: 'A', target: 'B', type: 'smoothstep', arrowStyle: 'end', style: { strokeWidth: 1.5 } } },
      ],
    }

    const snap = await materializeGraphBatchPayloadToSnapshot(payload, { replace: true })
    const inEdge = snap.edges.find((e) => e.id === 'e_in') as any
    const outEdge = snap.edges.find((e) => e.id === 'e_out') as any
    // We didn't set handles in ops; they should be inferred.
    expect(inEdge.sourceHandle).toBeTruthy()
    expect(inEdge.targetHandle).toBeTruthy()
    expect(outEdge.sourceHandle).toBeTruthy()
    expect(outEdge.targetHandle).toBeTruthy()

    // Ensure outgoing doesn't reuse A bottom if avoidable; should pick right in this configuration.
    expect(outEdge.sourceHandle).toBe('s-right')
    expect(outEdge.targetHandle).toBe('t-left')
  })

  it('avoids making left side both in+out: if left has in and B is left-down, prefer bottom', async () => {
    const payload: GraphBatchPayload = {
      version: '1.0',
      source: 'mermaid',
      graphType: 'flowchart',
      direction: 'LR',
      operations: [
        { op: 'graph.createNodeQuad', params: { id: 'A', title: 'A', shape: 'rect', position: { x: 0, y: 0 } } },
        { op: 'graph.createNodeQuad', params: { id: 'B', title: 'B', shape: 'rect', position: { x: -120, y: 120 } } }, // left-down of A
        { op: 'graph.createNodeQuad', params: { id: 'L', title: 'L', shape: 'rect', position: { x: -240, y: 0 } } }, // left of A
        { op: 'graph.createNodeQuad', params: { id: 'R', title: 'R', shape: 'rect', position: { x: 240, y: 0 } } }, // right of A

        // Seed: left side has incoming (L -> A should enter A from left, t-left)
        { op: 'graph.createEdge', params: { id: 'e_in_left', source: 'L', target: 'A', type: 'smoothstep', arrowStyle: 'end' } },
        // Seed: right side has outgoing (A -> R should leave A from right, s-right)
        { op: 'graph.createEdge', params: { id: 'e_out_right', source: 'A', target: 'R', type: 'smoothstep', arrowStyle: 'end' } },

        // Now: A -> B, with B left-down. Geometry might allow left or bottom.
        // Rule: avoid making left both in+out; prefer bottom if possible.
        { op: 'graph.createEdge', params: { id: 'e_out_diag', source: 'A', target: 'B', type: 'smoothstep', arrowStyle: 'end' } },
      ],
    }

    const snap = await materializeGraphBatchPayloadToSnapshot(payload, { replace: true })
    const e = snap.edges.find((ed) => ed.id === 'e_out_diag') as any
    expect(e.sourceHandle).toBeTruthy()
    expect(e.targetHandle).toBeTruthy()
    expect(e.sourceHandle).toBe('s-bottom')
    expect(e.targetHandle).toBe('t-top')
  })

  it('keeps flowchart edges pinned to handles with zero autoOffset', async () => {
    const payload: GraphBatchPayload = {
      version: '1.0',
      source: 'mermaid',
      graphType: 'flowchart',
      direction: 'LR',
      operations: [
        { op: 'graph.createNodeQuad', params: { id: 'A', title: 'A', shape: 'rect', position: { x: 0, y: 0 } } },
        { op: 'graph.createNodeQuad', params: { id: 'B', title: 'B', shape: 'rect', position: { x: 260, y: 0 } } },
        { op: 'graph.createNodeQuad', params: { id: 'C', title: 'C', shape: 'rect', position: { x: 260, y: 80 } } },
        { op: 'graph.createEdge', params: { id: 'e_ab', source: 'A', target: 'B', type: 'smoothstep', arrowStyle: 'end' } },
        { op: 'graph.createEdge', params: { id: 'e_ac', source: 'A', target: 'C', type: 'smoothstep', arrowStyle: 'end' } },
      ],
    }

    const snap = await materializeGraphBatchPayloadToSnapshot(payload, { replace: true })
    const eab = snap.edges.find((e) => e.id === 'e_ab') as any
    const eac = snap.edges.find((e) => e.id === 'e_ac') as any
    expect(eab.type).toBe('smoothstep')
    expect(eac.type).toBe('smoothstep')
    const offsets = [Number((eab.data ?? {}).autoOffset ?? 0), Number((eac.data ?? {}).autoOffset ?? 0)]
    expect(offsets.every((v) => v === 0)).toBe(true)
  })

  it('reroutes overlapping flowchart edges with extra bends to avoid nodes', async () => {
    const payload: GraphBatchPayload = {
      version: '1.0',
      source: 'mermaid',
      graphType: 'flowchart',
      direction: 'LR',
      operations: [
        { op: 'graph.createNodeQuad', params: { id: 'A', title: 'A', shape: 'rect', position: { x: 0, y: 0 } } },
        { op: 'graph.createNodeQuad', params: { id: 'M', title: 'M', shape: 'rect', position: { x: 240, y: 0 } } },
        { op: 'graph.createNodeQuad', params: { id: 'B', title: 'B', shape: 'rect', position: { x: 520, y: 0 } } },
        { op: 'graph.createEdge', params: { id: 'e_ab', source: 'A', target: 'B', type: 'bezier', arrowStyle: 'end' } },
      ],
    }

    const snap = await materializeGraphBatchPayloadToSnapshot(payload, { replace: true })
    const eab = snap.edges.find((e) => e.id === 'e_ab') as any
    expect(eab.sourceHandle).toBe('s-right')
    expect(eab.targetHandle).toBe('t-left')
    expect(eab.type).toBe('smoothstep')
    const wps = ((eab.data ?? {}).waypoints ?? []) as Array<{ x: number; y: number }>
    expect(wps.length).toBeGreaterThanOrEqual(3)
    expect(Number((eab.data ?? {}).autoOffset ?? 0)).toBe(0)
  })

  it('avoids 100% overlap when two flowchart edges share the same endpoints', async () => {
    const payload: GraphBatchPayload = {
      version: '1.0',
      source: 'mermaid',
      graphType: 'flowchart',
      direction: 'LR',
      operations: [
        { op: 'graph.createNodeQuad', params: { id: 'A', title: 'A', shape: 'rect', position: { x: 0, y: 0 } } },
        { op: 'graph.createNodeQuad', params: { id: 'B', title: 'B', shape: 'rect', position: { x: 320, y: 0 } } },
        { op: 'graph.createEdge', params: { id: 'e1', source: 'A', target: 'B', type: 'bezier', arrowStyle: 'end' } },
        { op: 'graph.createEdge', params: { id: 'e2', source: 'A', target: 'B', type: 'bezier', arrowStyle: 'end' } },
      ],
    }

    const snap = await materializeGraphBatchPayloadToSnapshot(payload, { replace: true })
    const e1 = snap.edges.find((e) => e.id === 'e1') as any
    const e2 = snap.edges.find((e) => e.id === 'e2') as any
    const w1 = JSON.stringify(((e1.data ?? {}).waypoints ?? []) as Array<{ x: number; y: number }>)
    const w2 = JSON.stringify(((e2.data ?? {}).waypoints ?? []) as Array<{ x: number; y: number }>)
    expect(w1).not.toBe(w2)
  })
})

describe('materializeGraphBatchPayloadToSnapshot - v2 nested frames', () => {
  it('creates nested frame as group with parentId', async () => {
    const payload: GraphBatchPayload = {
      version: '1.0',
      source: 'mermaid',
      graphType: 'flowchart',
      direction: 'LR',
      operations: [
        { op: 'graph.createFrame', params: { id: 'frame_fe', title: 'Frontend' } },
        { op: 'graph.createFrame', params: { id: 'frame_inner', title: '解决方案', parentId: 'frame_fe' } },
        { op: 'graph.createNodeQuad', params: { id: 'fe_a', title: '入口', parentId: 'frame_inner' } },
      ],
    }
    const snap = await materializeGraphBatchPayloadToSnapshot(payload, { replace: true })
    const outer = snap.nodes.find((n) => n.id === 'frame_fe') as any
    const inner = snap.nodes.find((n) => n.id === 'frame_inner') as any
    expect(outer.type).toBe('group')
    expect((outer.data ?? {}).role).toBe('frame')
    expect(inner.type).toBe('group')
    expect((inner.data ?? {}).role).toBe('frame')
    expect(inner.parentId).toBe('frame_fe')
  })
})
