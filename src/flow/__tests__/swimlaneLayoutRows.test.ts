import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { autoLayoutSwimlane } from '../swimlaneLayout'

function nodeById(nodes: Node<any>[], id: string): Node<any> {
  const node = nodes.find((n) => n.id === id)
  if (!node) throw new Error(`node not found: ${id}`)
  return node
}

describe('swimlane layout multi-row support', () => {
  it('places nodes with same laneCol in vertical stack (B below C)', () => {
    const lane: Node<any> = {
      id: 'lane-system',
      type: 'group',
      position: { x: 0, y: 0 },
      width: 900,
      height: 220,
      data: { role: 'lane', laneMeta: { laneIndex: 0, laneAxis: 'row' } },
    } as any
    const a: Node<any> = {
      id: 'A',
      type: 'quad',
      parentId: lane.id,
      position: { x: 0, y: 0 },
      width: 140,
      height: 56,
      data: { laneId: lane.id, nodeOrder: 0, laneRow: 0, laneCol: 0 },
    } as any
    const b: Node<any> = {
      id: 'B',
      type: 'quad',
      parentId: lane.id,
      position: { x: 0, y: 0 },
      width: 140,
      height: 56,
      data: { laneId: lane.id, nodeOrder: 1, laneRow: 1, laneCol: 2 },
    } as any
    const c: Node<any> = {
      id: 'C',
      type: 'quad',
      parentId: lane.id,
      position: { x: 0, y: 0 },
      width: 140,
      height: 56,
      data: { laneId: lane.id, nodeOrder: 2, laneRow: 0, laneCol: 2 },
    } as any

    const result = autoLayoutSwimlane({
      nodes: [lane, a, b, c],
      edges: [] as Edge<any>[],
      direction: 'LR',
      swimlaneDirection: 'horizontal',
    })
    const nextA = nodeById(result.nodes, 'A')
    const nextB = nodeById(result.nodes, 'B')
    const nextC = nodeById(result.nodes, 'C')

    expect(nextA.position.x).toBeLessThan(nextC.position.x)
    expect(Math.abs(nextB.position.x - nextC.position.x)).toBeLessThan(1e-6)
    expect(nextB.position.y).toBeGreaterThan(nextC.position.y)
  })

  it('keeps single row when laneRow is not provided', () => {
    const lane: Node<any> = {
      id: 'lane-system',
      type: 'group',
      position: { x: 0, y: 0 },
      width: 900,
      height: 220,
      data: { role: 'lane', laneMeta: { laneIndex: 0, laneAxis: 'row' } },
    } as any
    const a: Node<any> = {
      id: 'A',
      type: 'quad',
      parentId: lane.id,
      position: { x: 0, y: 0 },
      width: 140,
      height: 56,
      data: { laneId: lane.id, nodeOrder: 0 },
    } as any
    const b: Node<any> = {
      id: 'B',
      type: 'quad',
      parentId: lane.id,
      position: { x: 0, y: 0 },
      width: 140,
      height: 56,
      data: { laneId: lane.id, nodeOrder: 1 },
    } as any
    const c: Node<any> = {
      id: 'C',
      type: 'quad',
      parentId: lane.id,
      position: { x: 0, y: 0 },
      width: 140,
      height: 56,
      data: { laneId: lane.id, nodeOrder: 2 },
    } as any

    const result = autoLayoutSwimlane({
      nodes: [lane, a, b, c],
      edges: [] as Edge<any>[],
      direction: 'LR',
      swimlaneDirection: 'horizontal',
    })
    const nextA = nodeById(result.nodes, 'A')
    const nextB = nodeById(result.nodes, 'B')
    const nextC = nodeById(result.nodes, 'C')

    expect(Math.abs(nextA.position.y - nextB.position.y)).toBeLessThan(1e-6)
    expect(Math.abs(nextB.position.y - nextC.position.y)).toBeLessThan(1e-6)
  })

  it('increases in-lane node spacing when there is an edge label', () => {
    const lane: Node<any> = {
      id: 'lane-system',
      type: 'group',
      position: { x: 0, y: 0 },
      width: 900,
      height: 220,
      data: { role: 'lane', laneMeta: { laneIndex: 0, laneAxis: 'row' } },
    } as any
    const a: Node<any> = {
      id: 'A',
      type: 'quad',
      parentId: lane.id,
      position: { x: 0, y: 0 },
      width: 140,
      height: 56,
      data: { laneId: lane.id, nodeOrder: 0, laneRow: 0, laneCol: 0 },
    } as any
    const b: Node<any> = {
      id: 'B',
      type: 'quad',
      parentId: lane.id,
      position: { x: 0, y: 0 },
      width: 140,
      height: 56,
      data: { laneId: lane.id, nodeOrder: 1, laneRow: 0, laneCol: 1 },
    } as any
    const baseNodes = [lane, a, b]

    const noLabel = autoLayoutSwimlane({
      nodes: baseNodes.map((n) => ({ ...n, data: { ...(n.data ?? {}) }, position: { ...n.position } })) as Node<any>[],
      edges: [{ id: 'e1', source: 'A', target: 'B' } as Edge<any>],
      direction: 'LR',
      swimlaneDirection: 'horizontal',
    })
    const withLabel = autoLayoutSwimlane({
      nodes: baseNodes.map((n) => ({ ...n, data: { ...(n.data ?? {}) }, position: { ...n.position } })) as Node<any>[],
      edges: [{ id: 'e1', source: 'A', target: 'B', label: '库存校验失败需提示用户' } as Edge<any>],
      direction: 'LR',
      swimlaneDirection: 'horizontal',
    })

    const noLabelA = nodeById(noLabel.nodes, 'A')
    const noLabelB = nodeById(noLabel.nodes, 'B')
    const withLabelA = nodeById(withLabel.nodes, 'A')
    const withLabelB = nodeById(withLabel.nodes, 'B')

    const noLabelGap = noLabelB.position.x - noLabelA.position.x
    const withLabelGap = withLabelB.position.x - withLabelA.position.x
    expect(withLabelGap).toBeGreaterThan(noLabelGap)
  })
})
