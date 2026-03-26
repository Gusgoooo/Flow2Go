import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { autoLayoutDagre } from '../dagreLayout'

function extentX(nodes: Array<Node<any>>): number {
  if (nodes.length === 0) return 0
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  for (const n of nodes) {
    minX = Math.min(minX, n.position.x)
    maxX = Math.max(maxX, n.position.x)
  }
  return maxX - minX
}

describe('autoLayoutDagre label-aware spacing', () => {
  it('increases horizontal layout span when edges have labels', async () => {
    const nodes: Array<Node<any>> = [
      { id: 'A', type: 'quad', position: { x: 0, y: 0 }, width: 140, height: 56, data: {} } as any,
      { id: 'B', type: 'quad', position: { x: 0, y: 0 }, width: 140, height: 56, data: {} } as any,
      { id: 'C', type: 'quad', position: { x: 0, y: 0 }, width: 140, height: 56, data: {} } as any,
    ]
    const plainEdges: Array<Edge<any>> = [
      { id: 'e1', source: 'A', target: 'B' } as any,
      { id: 'e2', source: 'B', target: 'C' } as any,
    ]
    const labeledEdges: Array<Edge<any>> = [
      { id: 'e1', source: 'A', target: 'B', label: '这是一个较长的标签用于测试间距' } as any,
      { id: 'e2', source: 'B', target: 'C' } as any,
    ]

    const plain = await autoLayoutDagre(nodes, plainEdges, 'LR')
    const labeled = await autoLayoutDagre(nodes, labeledEdges, 'LR')

    expect(extentX(labeled)).toBeGreaterThan(extentX(plain))
  })
})

