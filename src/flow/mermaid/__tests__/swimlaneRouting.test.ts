import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { routeCrossLaneEdge } from '../../layout/routing/crossLaneRouter'
import { rerouteSwimlaneEdges } from '../../layout/routing/rerouteSwimlaneEdges'

describe('swimlane routing - crossLane corridor', () => {
  it('routes via public corridor and shifts right to avoid exclusion node', () => {
    const laneUser: Node<any> = {
      id: 'lane-user',
      type: 'group',
      position: { x: 100, y: 100 },
      width: 320,
      height: 180,
      data: { role: 'lane' },
    } as any
    const laneSystem: Node<any> = {
      id: 'lane-system',
      type: 'group',
      position: { x: 100, y: 320 },
      width: 320,
      height: 180,
      data: { role: 'lane' },
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
      position: { x: 24, y: 70 },
      width: 140,
      height: 56,
      data: { laneId: 'lane-system', semanticType: 'task' },
    } as any
    // 无关节点：故意放在默认 corridor 附近，迫使 corridor 右移
    const cacheRecord: Node<any> = {
      id: 'cache-record',
      type: 'quad',
      position: { x: 432, y: 300 },
      width: 120,
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
    expect(routed.waypoints.length).toBeGreaterThanOrEqual(4)
    // 默认 corridorX=452，若成功避让应大于该值
    const corridorX = routed.waypoints[1]?.x ?? routed.waypoints[0]?.x
    expect(corridorX).toBeGreaterThan(452)
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
