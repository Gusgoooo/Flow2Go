import { describe, expect, it } from 'vitest'
import { autoLayoutSwimlane } from '../swimlaneLayout'

describe('swimlane layout column span', () => {
  it('keeps larger visual gap for skipped laneCol values', () => {
    const lane: any = {
      id: 'lane-a',
      type: 'group',
      position: { x: 0, y: 0 },
      data: { role: 'lane', laneMeta: { laneIndex: 0, laneAxis: 'row' } },
      width: 960,
      height: 220,
    }
    const nodeA: any = {
      id: 'a',
      type: 'quad',
      parentId: lane.id,
      position: { x: 0, y: 0 },
      data: { laneId: lane.id, laneRow: 0, laneCol: 0, nodeOrder: 0 },
      width: 160,
      height: 48,
    }
    const nodeB: any = {
      id: 'b',
      type: 'quad',
      parentId: lane.id,
      position: { x: 0, y: 0 },
      data: { laneId: lane.id, laneRow: 0, laneCol: 1, nodeOrder: 1 },
      width: 160,
      height: 48,
    }
    const nodeC: any = {
      id: 'c',
      type: 'quad',
      parentId: lane.id,
      position: { x: 0, y: 0 },
      data: { laneId: lane.id, laneRow: 0, laneCol: 3, nodeOrder: 2 },
      width: 160,
      height: 48,
    }

    const laid = autoLayoutSwimlane({
      nodes: [lane, nodeA, nodeB, nodeC],
      edges: [],
      direction: 'LR',
      swimlaneDirection: 'horizontal',
    })

    const a = laid.nodes.find((n) => n.id === 'a')!
    const b = laid.nodes.find((n) => n.id === 'b')!
    const c = laid.nodes.find((n) => n.id === 'c')!
    const d1 = (b.position?.x ?? 0) - (a.position?.x ?? 0)
    const d2 = (c.position?.x ?? 0) - (b.position?.x ?? 0)

    expect(d1).toBeGreaterThan(0)
    expect(d2).toBeGreaterThan(d1)
    expect(d2 - d1).toBeGreaterThanOrEqual(32)
  })
})
