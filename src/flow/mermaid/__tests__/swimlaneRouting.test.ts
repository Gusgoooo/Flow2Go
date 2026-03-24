import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { routeCrossLaneEdge } from '../../layout/routing/crossLaneRouter'
import { rerouteSwimlaneEdges } from '../../layout/routing/rerouteSwimlaneEdges'

describe('swimlane routing - crossLane corridor', () => {
  it('uses vertical ports for row lanes and avoids wrong-side entry to target', () => {
    const laneUser: Node<any> = {
      id: 'lane-user',
      type: 'group',
      position: { x: 100, y: 100 },
      width: 320,
      height: 180,
      data: { role: 'lane', laneMeta: { laneAxis: 'row' } },
    } as any
    const laneSystem: Node<any> = {
      id: 'lane-system',
      type: 'group',
      position: { x: 100, y: 320 },
      width: 320,
      height: 180,
      data: { role: 'lane', laneMeta: { laneAxis: 'row' } },
    } as any
    const submit: Node<any> = {
      id: 'submit',
      type: 'quad',
      parentId: 'lane-user',
      position: { x: 24, y: 70 },
      width: 140,
      height: 56,
      data: { laneId: 'lane-user', semanticType: 'task' },
    } as any
    const review: Node<any> = {
      id: 'review',
      type: 'quad',
      parentId: 'lane-system',
      position: { x: 180, y: 70 },
      width: 140,
      height: 56,
      data: { laneId: 'lane-system', semanticType: 'task' },
    } as any
    // 无关节点：故意放在默认 corridorY 附近，迫使 corridorY 偏移
    const cacheRecord: Node<any> = {
      id: 'cache-record',
      type: 'quad',
      position: { x: 260, y: 286 },
      width: 100,
      height: 56,
      data: { semanticType: 'task' },
    } as any
    const edge: Edge<any> = { id: 'e1', source: 'submit', target: 'review', data: { semanticType: 'crossLane' } } as any
    const allNodes = [laneUser, laneSystem, submit, review, cacheRecord]

    const routed = routeCrossLaneEdge({
      edge,
      sourceNode: submit,
      targetNode: review,
      sourceLane: laneUser,
      targetLane: laneSystem,
      allNodes,
    })

    expect(routed.type).toBe('smoothstep')
    expect(routed.sourceHandle).toBe('s-bottom')
    expect(routed.targetHandle).toBe('t-top')
    expect(routed.waypoints.length).toBeGreaterThanOrEqual(4)
    const corridorY = routed.waypoints[1]?.y ?? 300
    expect(corridorY).not.toBe(300)

    const targetTopY = laneSystem.position.y + review.position.y
    const targetLead = routed.waypoints[routed.waypoints.length - 1]
    expect(targetLead.y).toBeLessThan(targetTopY)
  })

  it('uses horizontal ports for column lanes and keeps target entering from left side', () => {
    const laneA: Node<any> = {
      id: 'lane-a',
      type: 'group',
      position: { x: 100, y: 100 },
      width: 320,
      height: 260,
      data: { role: 'lane', laneMeta: { laneAxis: 'column' } },
    } as any
    const laneB: Node<any> = {
      id: 'lane-b',
      type: 'group',
      position: { x: 460, y: 100 },
      width: 320,
      height: 260,
      data: { role: 'lane', laneMeta: { laneAxis: 'column' } },
    } as any
    const src: Node<any> = {
      id: 'src',
      type: 'quad',
      parentId: laneA.id,
      position: { x: 160, y: 40 },
      width: 140,
      height: 56,
      data: { laneId: laneA.id, semanticType: 'task' },
    } as any
    const tgt: Node<any> = {
      id: 'tgt',
      type: 'quad',
      parentId: laneB.id,
      position: { x: 24, y: 120 },
      width: 140,
      height: 56,
      data: { laneId: laneB.id, semanticType: 'task' },
    } as any
    const blocker: Node<any> = {
      id: 'blocker',
      type: 'quad',
      position: { x: 804, y: 210 },
      width: 48,
      height: 60,
      data: { semanticType: 'task' },
    } as any

    const routed = routeCrossLaneEdge({
      edge: { id: 'e2', source: src.id, target: tgt.id } as any,
      sourceNode: src,
      targetNode: tgt,
      sourceLane: laneA,
      targetLane: laneB,
      allNodes: [laneA, laneB, src, tgt, blocker],
    })

    expect(routed.sourceHandle).toBe('s-right')
    expect(routed.targetHandle).toBe('t-left')
    const corridorX = routed.waypoints[1]?.x ?? 0
    expect(corridorX).toBeGreaterThan(812)
    const targetX = laneB.position.x + tgt.position.x
    const targetLead = routed.waypoints[routed.waypoints.length - 1]
    expect(targetLead.x).toBeLessThan(targetX)
  })

  it('avoids 100% overlap for duplicated cross-lane edges', () => {
    const laneUser: Node<any> = {
      id: 'lane-user',
      type: 'group',
      position: { x: 100, y: 100 },
      width: 320,
      height: 180,
      data: { role: 'lane', laneMeta: { laneAxis: 'row' } },
    } as any
    const laneSystem: Node<any> = {
      id: 'lane-system',
      type: 'group',
      position: { x: 100, y: 320 },
      width: 320,
      height: 180,
      data: { role: 'lane', laneMeta: { laneAxis: 'row' } },
    } as any
    const submit: Node<any> = {
      id: 'submit',
      type: 'quad',
      parentId: 'lane-user',
      position: { x: 24, y: 70 },
      width: 140,
      height: 56,
      data: { laneId: 'lane-user', semanticType: 'task' },
    } as any
    const review: Node<any> = {
      id: 'review',
      type: 'quad',
      parentId: 'lane-system',
      position: { x: 180, y: 70 },
      width: 140,
      height: 56,
      data: { laneId: 'lane-system', semanticType: 'task' },
    } as any
    const edges: Edge<any>[] = [
      { id: 'e1', source: 'submit', target: 'review', data: { semanticType: 'crossLane' } } as any,
      { id: 'e2', source: 'submit', target: 'review', data: { semanticType: 'crossLane' } } as any,
    ]

    const routed = rerouteSwimlaneEdges([laneUser, laneSystem, submit, review], edges)
    const e1 = routed.find((e) => e.id === 'e1') as any
    const e2 = routed.find((e) => e.id === 'e2') as any
    const w1 = JSON.stringify(((e1.data ?? {}).waypoints ?? []) as Array<{ x: number; y: number }>)
    const w2 = JSON.stringify(((e2.data ?? {}).waypoints ?? []) as Array<{ x: number; y: number }>)
    expect(w1).not.toBe(w2)
  })
})

describe('swimlane routing - normal chain regression', () => {
  it('keeps A->B->C with right-out left-in handles', () => {
    const lane: Node<any> = {
      id: 'lane-system',
      type: 'group',
      position: { x: 100, y: 100 },
      width: 700,
      height: 180,
      data: { role: 'lane' },
    } as any
    const a: Node<any> = {
      id: 'A',
      type: 'quad',
      parentId: lane.id,
      position: { x: 20, y: 60 },
      width: 140,
      height: 56,
      data: { laneId: lane.id, semanticType: 'task', nodeOrder: 1 },
    } as any
    const b: Node<any> = {
      id: 'B',
      type: 'quad',
      parentId: lane.id,
      position: { x: 220, y: 60 },
      width: 140,
      height: 56,
      data: { laneId: lane.id, semanticType: 'task', nodeOrder: 2 },
    } as any
    const c: Node<any> = {
      id: 'C',
      type: 'quad',
      parentId: lane.id,
      position: { x: 420, y: 60 },
      width: 140,
      height: 56,
      data: { laneId: lane.id, semanticType: 'task', nodeOrder: 3 },
    } as any

    const edges: Edge<any>[] = [
      { id: 'e-ab', source: 'A', target: 'B', type: 'bezier', data: {} } as any,
      { id: 'e-bc', source: 'B', target: 'C', type: 'bezier', data: {} } as any,
    ]

    const routed = rerouteSwimlaneEdges([lane, a, b, c], edges)
    for (const e of routed) {
      expect(e.sourceHandle).toBe('s-right')
      expect(e.targetHandle).toBe('t-left')
      expect((e.data as any)?.semanticType).toBe('normal')
    }
  })
})

describe('swimlane routing - return flow handles', () => {
  const lane: Node<any> = {
    id: 'lane-system',
    type: 'group',
    position: { x: 100, y: 100 },
    width: 900,
    height: 180,
    data: { role: 'lane', laneMeta: { laneAxis: 'row' } },
  } as any
  const a: Node<any> = {
    id: 'A',
    type: 'quad',
    parentId: lane.id,
    position: { x: 20, y: 60 },
    width: 140,
    height: 56,
    data: { laneId: lane.id, semanticType: 'task', nodeOrder: 1 },
  } as any
  const b: Node<any> = {
    id: 'B',
    type: 'quad',
    parentId: lane.id,
    position: { x: 220, y: 60 },
    width: 140,
    height: 56,
    data: { laneId: lane.id, semanticType: 'task', nodeOrder: 2 },
  } as any
  const c: Node<any> = {
    id: 'C',
    type: 'quad',
    parentId: lane.id,
    position: { x: 520, y: 60 },
    width: 140,
    height: 56,
    data: { laneId: lane.id, semanticType: 'task', nodeOrder: 3 },
  } as any

  it('uses left->right for short backward edge to preserve geometric direction', () => {
    const edges: Edge<any>[] = [
      { id: 'e-ba', source: 'B', target: 'A', type: 'bezier', data: {} } as any,
    ]

    const [edge] = rerouteSwimlaneEdges([lane, a, b, c], edges)
    expect(edge.sourceHandle).toBe('s-left')
    expect(edge.targetHandle).toBe('t-right')
    expect((edge.data as any)?.semanticType).toBe('returnFlow')
    expect(edge.animated).toBe(true)
    expect((edge.data as any)?.autoReturnFlowAnimated).toBe(true)
  })

  it('uses vertical loop for long backward edge to avoid horizontal folding', () => {
    const edges: Edge<any>[] = [
      { id: 'e-ca', source: 'C', target: 'A', type: 'bezier', data: {} } as any,
    ]

    const [edge] = rerouteSwimlaneEdges([lane, a, b, c], edges)
    expect(edge.sourceHandle).toBe('s-bottom')
    expect(edge.targetHandle).toBe('t-bottom')
    expect((edge.data as any)?.semanticType).toBe('returnFlow')
    expect(edge.animated).toBe(true)
    expect((edge.data as any)?.autoReturnFlowAnimated).toBe(true)
  })

  it('clears auto animation when an auto-marked edge is no longer returnFlow', () => {
    const edges: Edge<any>[] = [
      {
        id: 'e-ab',
        source: 'A',
        target: 'B',
        type: 'bezier',
        animated: true,
        data: { autoReturnFlowAnimated: true },
      } as any,
    ]

    const [edge] = rerouteSwimlaneEdges([lane, a, b, c], edges)
    expect((edge.data as any)?.semanticType).toBe('normal')
    expect(edge.animated).toBe(false)
    expect((edge.data as any)?.autoReturnFlowAnimated).toBeUndefined()
  })
})
